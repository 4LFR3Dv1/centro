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
  const [processes, lessonResult, lessonSummaryResult, exams] = await Promise.all([
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
