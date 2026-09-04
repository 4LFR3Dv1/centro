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

export type StudentCalendarView = {
  upcoming: StudentLessonView[];
  past: StudentLessonView[];
};

function mapRows(rows: Array<{
  id: string;
  enrollment_id: string;
  category: PhysicalCategory;
  starts_at: Date;
  ends_at: Date;
  status: StudentLessonStatus;
  instructor_name: string;
  vehicle_label: string;
  notes: string | null;
}>): StudentLessonView[] {
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

export async function getStudentCalendar(pool: pg.Pool, studentId: string): Promise<StudentCalendarView> {
  const [upcomingResult, pastResult] = await Promise.all([
    pool.query<{
      id: string;
      enrollment_id: string;
      category: PhysicalCategory;
      starts_at: Date;
      ends_at: Date;
      status: StudentLessonStatus;
      instructor_name: string;
      vehicle_label: string;
      notes: string | null;
    }>(
      `SELECT l.id, l.enrollment_id, l.category, l.starts_at, l.ends_at, l.status,
              i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
       FROM lessons l
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.student_id = $1
         AND l.status = 'SCHEDULED'
         AND l.ends_at >= now()
       ORDER BY l.starts_at ASC
       LIMIT 40`,
      [studentId],
    ),
    pool.query<{
      id: string;
      enrollment_id: string;
      category: PhysicalCategory;
      starts_at: Date;
      ends_at: Date;
      status: StudentLessonStatus;
      instructor_name: string;
      vehicle_label: string;
      notes: string | null;
    }>(
      `SELECT l.id, l.enrollment_id, l.category, l.starts_at, l.ends_at, l.status,
              i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
       FROM lessons l
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
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

export async function getStudentLesson(
  pool: pg.Pool,
  studentId: string,
  lessonId: string,
): Promise<StudentLessonView | null> {
  const result = await pool.query<{
    id: string;
    enrollment_id: string;
    category: PhysicalCategory;
    starts_at: Date;
    ends_at: Date;
    status: StudentLessonStatus;
    instructor_name: string;
    vehicle_label: string;
    notes: string | null;
  }>(
    `SELECT l.id, l.enrollment_id, l.category, l.starts_at, l.ends_at, l.status,
            i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
     FROM lessons l
     JOIN instructors i ON i.id = l.instructor_id
     JOIN vehicles v ON v.id = l.vehicle_id
     WHERE l.id = $1 AND l.student_id = $2
     LIMIT 1`,
    [lessonId, studentId],
  );
  return result.rows[0] ? mapRows(result.rows)[0] : null;
}
