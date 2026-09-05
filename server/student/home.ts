import type pg from 'pg';
import { resolveStudentProcesses, type EnrollmentProcessView } from '../process/resolver.js';
import { listStudentExams, type StudentExamView } from './exams.js';

export type StudentHomeAction = {
  code: string;
  title: string;
  detail: string;
  href: string;
  dueAt: Date | null;
  kind: 'SECURITY' | 'LESSON' | 'EXAM' | 'PROCESS';
};

export type StudentHomeView = {
  process: EnrollmentProcessView | null;
  primaryAction: StudentHomeAction | null;
  nextLesson: {
    id: string;
    enrollmentId: string;
    category: 'A' | 'B' | 'D';
    startsAt: Date;
    endsAt: Date;
    instructorName: string;
    vehicleLabel: string;
  } | null;
  nextExam: StudentExamView | null;
  lessonSummary: {
    completed: number;
    scheduled: number;
    noShows: number;
    cancelled: number;
  };
};

function processAction(process: EnrollmentProcessView | null): StudentHomeAction | null {
  if (!process?.nextAction) return null;
  const action = process.nextAction;
  if (action.code === 'PROCESS_PAUSED') {
    return {
      code: 'WAIT_SCHOOL_REACTIVATE_ENROLLMENT',
      title: 'Sua matrícula está pausada.',
      detail: 'A escola precisa reativar a matrícula antes de o processo continuar. Você não precisa fazer nada no Centro agora.',
      href: '/aluno/processo',
      dueAt: null,
      kind: 'PROCESS',
    };
  }
  if (action.code === 'PROCESS_CANCELLED') {
    return {
      code: 'WAIT_CANCELLED_ENROLLMENT',
      title: 'Esta matrícula foi cancelada.',
      detail: 'Não existe uma próxima etapa nesta matrícula. Fale com a escola se precisar entender ou revisar essa situação.',
      href: '/aluno/processo',
      dueAt: null,
      kind: 'PROCESS',
    };
  }
  let href = '/aluno/processo';
  if (action.code.includes('LESSON')) href = '/aluno/agenda';
  if (action.code.includes('PRACTICAL_EXAM')) href = '/aluno/exame';
  return {
    code: action.code,
    title: action.title,
    detail: action.detail,
    href,
    dueAt: null,
    kind: 'PROCESS',
  };
}

export async function getStudentHome(pool: pg.Pool, studentId: string): Promise<StudentHomeView> {
  const [processes, lessonResult, lessonSummaryResult, latestLessonResult, latestTheoryResult, exams] = await Promise.all([
    resolveStudentProcesses(pool, studentId),
    pool.query<{
      id: string;
      enrollment_id: string;
      category: 'A' | 'B' | 'D';
      starts_at: Date;
      ends_at: Date;
      instructor_name: string;
      vehicle_label: string;
    }>(
      `SELECT l.id, l.enrollment_id, l.category, l.starts_at, l.ends_at,
              i.display_name AS instructor_name, v.label AS vehicle_label
       FROM lessons l
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.student_id = $1
         AND l.status = 'SCHEDULED'
         AND l.ends_at >= now()
       ORDER BY l.starts_at ASC
       LIMIT 1`,
      [studentId],
    ),
    pool.query<{
      completed: string;
      scheduled: string;
      no_shows: string;
      cancelled: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed,
         count(*) FILTER (WHERE status = 'SCHEDULED')::text AS scheduled,
         count(*) FILTER (WHERE status = 'NO_SHOW')::text AS no_shows,
         count(*) FILTER (WHERE status = 'CANCELLED')::text AS cancelled
       FROM lessons
       WHERE student_id = $1`,
      [studentId],
    ),
    pool.query<{
      enrollment_id: string;
      status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
    }>(
      `SELECT enrollment_id, status
       FROM lessons
       WHERE student_id = $1
       ORDER BY starts_at DESC
       LIMIT 1`,
      [studentId],
    ),
    pool.query<{
      enrollment_id: string;
      attendance_status: 'PENDING' | 'PRESENT' | 'ABSENT';
      official_result: 'PENDING' | 'APPROVED' | 'FAILED';
    }>(
      `SELECT enrollment_id, attendance_status, official_result
       FROM theory_exam_attempts
       WHERE student_id = $1
       ORDER BY scheduled_for DESC, created_at DESC
       LIMIT 1`,
      [studentId],
    ),
    listStudentExams(pool, studentId),
  ]);

  const process = processes[0] ?? null;
  const lessonRow = lessonResult.rows[0];
  const nextLesson = lessonRow ? {
    id: lessonRow.id,
    enrollmentId: lessonRow.enrollment_id,
    category: lessonRow.category,
    startsAt: lessonRow.starts_at,
    endsAt: lessonRow.ends_at,
    instructorName: lessonRow.instructor_name,
    vehicleLabel: lessonRow.vehicle_label,
  } : null;
  const nextExam = exams
    .filter((exam) => exam.officialScheduledFor.getTime() >= Date.now() && ['PLANNED', 'CONFIRMED'].includes(exam.sessionStatus))
    .sort((a, b) => a.officialScheduledFor.getTime() - b.officialScheduledFor.getTime())[0] ?? null;

  let primaryAction = processAction(process);
  if (nextLesson && (!nextExam || nextLesson.startsAt.getTime() <= nextExam.officialScheduledFor.getTime())) {
    primaryAction = {
      code: 'ATTEND_NEXT_LESSON',
      title: 'Sua próxima aula prática',
      detail: `${nextLesson.instructorName} · ${nextLesson.vehicleLabel}`,
      href: `/aluno/agenda/${nextLesson.id}`,
      dueAt: nextLesson.startsAt,
      kind: 'LESSON',
    };
  } else if (nextExam) {
    primaryAction = {
      code: 'PREPARE_PRACTICAL_EXAM',
      title: 'Prepare-se para o exame prático',
      detail: `${nextExam.locationLabel} · categoria ${nextExam.category}`,
      href: `/aluno/exame/${nextExam.candidateId}`,
      dueAt: nextExam.officialScheduledFor,
      kind: 'EXAM',
    };
  } else if (process?.currentState.code === 'THEORY_PASSED') {
    const latestTheory = latestTheoryResult.rows[0] ?? null;
    if (latestTheory?.enrollment_id === process.enrollment.id && latestTheory.attendance_status === 'ABSENT') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_THEORY_ABSENCE',
        title: 'Sua última prova teórica foi registrada como ausência.',
        detail: 'A escola precisa marcar uma nova tentativa. Você não precisa fazer nada no Centro agora.',
        href: '/aluno/processo',
        dueAt: null,
        kind: 'PROCESS',
      };
    } else if (latestTheory?.enrollment_id === process.enrollment.id && latestTheory.official_result === 'FAILED') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_THEORY_FAILURE',
        title: 'O resultado oficial da sua última prova teórica foi reprovação.',
        detail: 'A escola precisa organizar uma nova tentativa. Quando houver uma data, ela aparecerá aqui.',
        href: '/aluno/processo',
        dueAt: null,
        kind: 'PROCESS',
      };
    } else if (process.nextAction?.code === 'SCHEDULE_THEORY_EXAM') {
      primaryAction = {
        code: 'SCHOOL_SCHEDULE_THEORY_EXAM',
        title: 'A escola precisa marcar sua prova teórica.',
        detail: 'Você não precisa fazer nada no Centro agora. Quando a data for registrada, ela aparecerá aqui.',
        href: '/aluno/processo',
        dueAt: null,
        kind: 'PROCESS',
      };
    }
  } else if (process?.currentState.code === 'PRACTICE_DONE') {
    const latestLesson = latestLessonResult.rows[0] ?? null;
    if (latestLesson?.enrollment_id === process.enrollment.id && latestLesson.status === 'NO_SHOW') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_LESSON_NO_SHOW',
        title: 'Sua última aula foi registrada como falta.',
        detail: 'Essa aula não conta como concluída. A escola precisa marcar o próximo horário; você não precisa fazer nada no Centro agora.',
        href: '/aluno/agenda',
        dueAt: null,
        kind: 'LESSON',
      };
    } else if (latestLesson?.enrollment_id === process.enrollment.id && latestLesson.status === 'CANCELLED') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_LESSON_CANCELLED',
        title: 'Sua última aula foi cancelada.',
        detail: 'A escola precisa marcar um novo horário se sua preparação prática ainda não terminou. Você não precisa fazer nada no Centro agora.',
        href: '/aluno/agenda',
        dueAt: null,
        kind: 'LESSON',
      };
    }
  } else if (process?.currentState.code === 'PRACTICAL_EXAM_PASSED') {
    const latestExam = exams[0] ?? null;
    if (latestExam?.enrollmentId === process.enrollment.id && latestExam.attendanceStatus === 'ABSENT') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_PRACTICAL_ABSENCE',
        title: 'Sua última tentativa prática foi registrada como ausência.',
        detail: 'A escola precisa organizar uma nova tentativa. Você não precisa fazer nada no Centro agora.',
        href: `/aluno/exame/${latestExam.candidateId}`,
        dueAt: null,
        kind: 'EXAM',
      };
    } else if (latestExam?.enrollmentId === process.enrollment.id && latestExam.officialResult === 'FAILED') {
      primaryAction = {
        code: 'WAIT_SCHOOL_AFTER_PRACTICAL_FAILURE',
        title: 'O resultado oficial do seu último exame prático foi reprovação.',
        detail: 'A escola precisa organizar uma nova tentativa. Quando houver uma nova data, ela aparecerá aqui.',
        href: `/aluno/exame/${latestExam.candidateId}`,
        dueAt: null,
        kind: 'EXAM',
      };
    }
  }

  const summary = lessonSummaryResult.rows[0];
  return {
    process,
    primaryAction,
    nextLesson,
    nextExam,
    lessonSummary: {
      completed: Number(summary?.completed ?? 0),
      scheduled: Number(summary?.scheduled ?? 0),
      noShows: Number(summary?.no_shows ?? 0),
      cancelled: Number(summary?.cancelled ?? 0),
    },
  };
}
