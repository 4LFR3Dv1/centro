import type pg from 'pg';
import {
  resolveStudentOperationalContext,
  type SchoolOperationalAction,
  type SchoolOperationalSeverity,
} from './student-operations.js';

export const ADMIN_TODAY_TIMEZONE = 'America/Sao_Paulo';
export const ADMIN_HOME_VERSION = 'ADMIN_HOME_V2' as const;

type HomeEventKind = 'LESSON' | 'THEORY_EXAM' | 'PRACTICAL_EXAM';

export type AdminHomeEvent = {
  id: string;
  kind: HomeEventKind;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  title: string;
  detail: string;
  category: 'A' | 'B' | 'AB' | 'D' | null;
  startsAt: Date;
  endsAt: Date | null;
  href: string;
};

export type AdminHomeAttention = {
  studentId: string;
  studentPublicId: string;
  studentName: string;
  action: SchoolOperationalAction;
};

export type AdminHomeFirstAccess = {
  studentId: string;
  studentPublicId: string;
  studentName: string;
};

export type AdminHomeProjection = {
  version: typeof ADMIN_HOME_VERSION;
  timezone: typeof ADMIN_TODAY_TIMEZONE;
  generatedAt: Date;
  now: AdminHomeEvent[];
  upcoming: AdminHomeEvent[];
  attention: {
    blocking: AdminHomeAttention[];
    actionRequired: AdminHomeAttention[];
    waiting: AdminHomeAttention[];
  };
  pendingFirstAccess: AdminHomeFirstAccess[];
  summary: {
    activeNow: number;
    upcoming24h: number;
    blocking: number;
    actionRequired: number;
    waiting: number;
    scheduledProcesses: number;
    pendingFirstAccess: number;
  };
};

const severityRank: Record<SchoolOperationalSeverity, number> = {
  BLOCKING: 0,
  ACTION_REQUIRED: 1,
  SCHEDULED: 2,
  WAITING: 3,
  COMPLETE: 4,
};

function sortAttention(a: AdminHomeAttention, b: AdminHomeAttention): number {
  const severity = severityRank[a.action.severity] - severityRank[b.action.severity];
  if (severity !== 0) return severity;
  const student = a.studentName.localeCompare(b.studentName, 'pt-BR');
  if (student !== 0) return student;
  return a.action.title.localeCompare(b.action.title, 'pt-BR');
}

function sortEvents(a: AdminHomeEvent, b: AdminHomeEvent): number {
  const time = a.startsAt.getTime() - b.startsAt.getTime();
  if (time !== 0) return time;
  return a.studentName.localeCompare(b.studentName, 'pt-BR');
}

export async function projectAdminHome(pool: pg.Pool): Promise<AdminHomeProjection> {
  const generatedAt = new Date();

  const [studentsResult, lessonResult, theoryResult, practicalResult, accessResult] = await Promise.all([
    pool.query<{
      id: string;
      public_id: string;
      full_name: string;
    }>(
      `SELECT DISTINCT s.id, s.public_id, s.full_name
       FROM students s
       JOIN enrollments e ON e.student_id = s.id
       WHERE s.status = 'ACTIVE'
         AND e.status IN ('ACTIVE', 'PAUSED')
       ORDER BY s.full_name ASC
       LIMIT 500`,
    ),
    pool.query<{
      id: string;
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      instructor_name: string;
      vehicle_label: string;
      category: 'A' | 'B' | 'D';
      starts_at: Date;
      ends_at: Date;
    }>(
      `SELECT l.id, l.enrollment_id, l.student_id, s.public_id, s.full_name,
              i.display_name AS instructor_name, v.label AS vehicle_label,
              l.category, l.starts_at, l.ends_at
       FROM lessons l
       JOIN students s ON s.id = l.student_id
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.status = 'SCHEDULED'
         AND l.ends_at > now()
         AND l.starts_at < now() + interval '24 hours'
       ORDER BY l.starts_at ASC, s.full_name ASC
       LIMIT 80`,
    ),
    pool.query<{
      id: string;
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      category: 'A' | 'B' | 'AB' | 'D';
      scheduled_for: Date;
    }>(
      `SELECT a.id, a.enrollment_id, a.student_id, s.public_id, s.full_name,
              e.category, a.scheduled_for
       FROM theory_exam_attempts a
       JOIN students s ON s.id = a.student_id
       JOIN enrollments e ON e.id = a.enrollment_id
       WHERE a.resolved_at IS NULL
         AND a.scheduled_for >= now()
         AND a.scheduled_for < now() + interval '24 hours'
         AND s.status = 'ACTIVE'
         AND e.status = 'ACTIVE'
       ORDER BY a.scheduled_for ASC, s.full_name ASC
       LIMIT 40`,
    ),
    pool.query<{
      id: string;
      session_id: string;
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      category: 'A' | 'B' | 'D';
      location_label: string;
      official_scheduled_for: Date;
      session_starts_at: Date;
      session_ends_at: Date;
    }>(
      `SELECT c.id, c.session_id, c.enrollment_id, c.student_id,
              st.public_id, st.full_name, s.category, s.location_label,
              c.official_scheduled_for, s.starts_at AS session_starts_at,
              s.ends_at AS session_ends_at
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions s ON s.id = c.session_id
       JOIN students st ON st.id = c.student_id
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE c.official_result = 'PENDING'
         AND s.status IN ('PLANNED', 'CONFIRMED')
         AND s.ends_at > now()
         AND c.official_scheduled_for < now() + interval '24 hours'
         AND st.status = 'ACTIVE'
         AND e.status = 'ACTIVE'
       ORDER BY c.official_scheduled_for ASC, st.full_name ASC
       LIMIT 40`,
    ),
    pool.query<{
      student_id: string;
      public_id: string;
      full_name: string;
    }>(
      `SELECT DISTINCT s.id AS student_id, s.public_id, s.full_name
       FROM students s
       JOIN enrollments e ON e.student_id = s.id
       LEFT JOIN student_credentials c ON c.student_id = s.id
       WHERE s.status = 'ACTIVE'
         AND e.status = 'ACTIVE'
         AND (c.student_id IS NULL OR (c.must_change_password = true AND c.disabled_at IS NULL))
       ORDER BY s.full_name ASC
       LIMIT 40`,
    ),
  ]);

  const contexts = await Promise.all(
    studentsResult.rows.map(async (student) => ({
      student,
      context: await resolveStudentOperationalContext(pool, student.id),
    })),
  );

  const allActions: AdminHomeAttention[] = contexts.flatMap(({ student, context }) =>
    context.actions.map((action) => ({
      studentId: student.id,
      studentPublicId: student.public_id,
      studentName: student.full_name,
      action,
    })),
  ).sort(sortAttention);

  const attention = {
    blocking: allActions.filter((item) => item.action.severity === 'BLOCKING'),
    actionRequired: allActions.filter((item) => item.action.severity === 'ACTION_REQUIRED'),
    waiting: allActions.filter((item) => item.action.severity === 'WAITING'),
  };

  const events: AdminHomeEvent[] = [
    ...lessonResult.rows.map((row): AdminHomeEvent => ({
      id: row.id,
      kind: 'LESSON',
      enrollmentId: row.enrollment_id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      title: `Aula prática · ${row.category}`,
      detail: `${row.instructor_name} · ${row.vehicle_label}`,
      category: row.category,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      href: '/admin/agenda',
    })),
    ...theoryResult.rows.map((row): AdminHomeEvent => ({
      id: row.id,
      kind: 'THEORY_EXAM',
      enrollmentId: row.enrollment_id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      title: 'Prova teórica',
      detail: 'Tentativa teórica aberta',
      category: row.category,
      startsAt: row.scheduled_for,
      endsAt: null,
      href: `/admin/alunos/${row.student_id}`,
    })),
    ...practicalResult.rows.map((row): AdminHomeEvent => ({
      id: row.id,
      kind: 'PRACTICAL_EXAM',
      enrollmentId: row.enrollment_id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      title: `Exame prático · ${row.category}`,
      detail: row.location_label,
      category: row.category,
      startsAt: row.official_scheduled_for,
      endsAt: row.session_ends_at,
      href: '/admin/exames',
    })),
  ].sort(sortEvents);

  const now = events.filter((event) => {
    if (!event.endsAt) return false;
    return event.startsAt.getTime() <= generatedAt.getTime() && event.endsAt.getTime() > generatedAt.getTime();
  });
  const activeIds = new Set(now.map((event) => `${event.kind}:${event.id}`));
  const upcoming = events.filter((event) => !activeIds.has(`${event.kind}:${event.id}`) && event.startsAt.getTime() >= generatedAt.getTime());

  const pendingFirstAccess = accessResult.rows.map((row) => ({
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
  }));

  return {
    version: ADMIN_HOME_VERSION,
    timezone: ADMIN_TODAY_TIMEZONE,
    generatedAt,
    now,
    upcoming,
    attention,
    pendingFirstAccess,
    summary: {
      activeNow: now.length,
      upcoming24h: upcoming.length,
      blocking: attention.blocking.length,
      actionRequired: attention.actionRequired.length,
      waiting: attention.waiting.length,
      scheduledProcesses: allActions.filter((item) => item.action.severity === 'SCHEDULED').length,
      pendingFirstAccess: pendingFirstAccess.length,
    },
  };
}

// Compatibility export for ADMIN-004 callers during the ADMIN-HOME-002 cutover.
export const projectAdminToday = projectAdminHome;
