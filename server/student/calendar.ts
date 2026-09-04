import type pg from 'pg';
import type { PhysicalCategory } from '../schedule/contracts.js';

export type StudentLessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export type StudentLessonView = {
  id: string;
  enrollmentId: string;
  category: PhysicalCategory;
  startsAt: Date;
  endsAt: Date;
  status: StudentLessonStatus;
  instructorName: string;
  vehicleLabel: string;
  notes: string | null;
};

export type StudentCalendarEvent = {
  id: string;
  kind: 'LESSON' | 'PRACTICAL_EXAM';
  startsAt: Date;
  endsAt: Date;
  title: string;
  subtitle: string;
  status: string;
  category: PhysicalCategory;
  detailHref: string;
};

export type StudentCalendarView = {
  upcoming: StudentLessonView[];
  past: StudentLessonView[];
};

type LessonRow = {
  id: string;
  enrollment_id: string;
  category: PhysicalCategory;
  starts_at: Date;
  ends_at: Date;
  status: StudentLessonStatus;
  instructor_name: string;
  vehicle_label: string;
  notes: string | null;
};

function mapRows(rows: LessonRow[]): StudentLessonView[] {
  return rows.map((row) => ({
    id: row.id,
    enrollmentId: row.enrollment_id,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    instructorName: row.instructor_name,
    vehicleLabel: row.vehicle_label,
    notes: row.notes,
  }));
}

const LESSON_SELECT = `
  SELECT l.id, l.enrollment_id, l.category, l.starts_at, l.ends_at, l.status,
         i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
  FROM lessons l
  JOIN instructors i ON i.id = l.instructor_id
  JOIN vehicles v ON v.id = l.vehicle_id
`;

export async function getStudentCalendar(pool: pg.Pool, studentId: string): Promise<StudentCalendarView> {
  const [upcomingResult, pastResult] = await Promise.all([
    pool.query<LessonRow>(
      `${LESSON_SELECT}
       WHERE l.student_id = $1
         AND l.status = 'SCHEDULED'
         AND l.ends_at >= now()
       ORDER BY l.starts_at ASC
       LIMIT 40`,
      [studentId],
    ),
    pool.query<LessonRow>(
      `${LESSON_SELECT}
       WHERE l.student_id = $1
         AND (l.status <> 'SCHEDULED' OR l.ends_at < now())
       ORDER BY l.starts_at DESC
       LIMIT 60`,
      [studentId],
    ),
  ]);

  return {
    upcoming: mapRows(upcomingResult.rows),
    past: mapRows(pastResult.rows),
  };
}

export async function getStudentCalendarRange(
  pool: pg.Pool,
  studentId: string,
  input: { from: Date; to: Date },
): Promise<StudentCalendarEvent[]> {
  const [lessonResult, examResult] = await Promise.all([
    pool.query<LessonRow>(
      `${LESSON_SELECT}
       WHERE l.student_id = $1
         AND l.starts_at < $3
         AND l.ends_at > $2
       ORDER BY l.starts_at ASC`,
      [studentId, input.from, input.to],
    ),
    pool.query<{
      candidate_id: string;
      category: PhysicalCategory;
      official_scheduled_for: Date;
      session_ends_at: Date;
      session_status: string;
      official_result: string;
      location_label: string;
      instructor_name: string;
      vehicle_label: string;
    }>(
      `SELECT c.id AS candidate_id, s.category, c.official_scheduled_for,
              s.ends_at AS session_ends_at, s.status AS session_status,
              c.official_result, s.location_label,
              i.display_name AS instructor_name, v.label AS vehicle_label
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions s ON s.id = c.session_id
       JOIN enrollments e ON e.id = c.enrollment_id AND e.student_id = c.student_id
       JOIN instructors i ON i.id = s.instructor_id
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE c.student_id = $1
         AND c.official_scheduled_for >= $2
         AND c.official_scheduled_for < $3
       ORDER BY c.official_scheduled_for ASC`,
      [studentId, input.from, input.to],
    ),
  ]);

  const lessonEvents: StudentCalendarEvent[] = lessonResult.rows.map((row) => ({
    id: `lesson:${row.id}`,
    kind: 'LESSON',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    title: `Aula categoria ${row.category}`,
    subtitle: `${row.instructor_name} · ${row.vehicle_label}`,
    status: row.status,
    category: row.category,
    detailHref: `/aluno/agenda/${row.id}`,
  }));

  const examEvents: StudentCalendarEvent[] = examResult.rows.map((row) => {
    const defaultEnd = new Date(row.official_scheduled_for.getTime() + 30 * 60 * 1000);
    const endsAt = defaultEnd.getTime() < row.session_ends_at.getTime() ? defaultEnd : row.session_ends_at;
    return {
      id: `exam:${row.candidate_id}`,
      kind: 'PRACTICAL_EXAM',
      startsAt: row.official_scheduled_for,
      endsAt,
      title: `Exame prático · ${row.category}`,
      subtitle: `${row.location_label} · ${row.instructor_name} · ${row.vehicle_label}`,
      status: row.official_result !== 'PENDING' ? `OFFICIAL_${row.official_result}` : row.session_status,
      category: row.category,
      detailHref: `/aluno/exame/${row.candidate_id}`,
    };
  });

  return [...lessonEvents, ...examEvents].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function getStudentLesson(
  pool: pg.Pool,
  studentId: string,
  lessonId: string,
): Promise<StudentLessonView | null> {
  const result = await pool.query<LessonRow>(
    `${LESSON_SELECT}
     WHERE l.id = $1 AND l.student_id = $2
     LIMIT 1`,
    [lessonId, studentId],
  );
  return result.rows[0] ? mapRows(result.rows)[0] : null;
}
