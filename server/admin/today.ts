import type pg from 'pg';

export const ADMIN_TODAY_TIMEZONE = 'America/Sao_Paulo';

type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
type ExamCode = 'THEORY_PASSED' | 'PRACTICAL_EXAM_PASSED';

export type AdminTodayLesson = {
  id: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  instructorName: string;
  vehicleLabel: string;
  category: 'A' | 'B' | 'D';
  startsAt: Date;
  endsAt: Date;
  status: LessonStatus;
};

export type AdminTodayExam = {
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  code: ExamCode;
  scheduledFor: Date;
};

export type AdminTodayStudentAttention = {
  studentId: string;
  studentPublicId: string;
  studentName: string;
};

export type AdminTodayEnrollmentAttention = AdminTodayStudentAttention & {
  enrollmentId: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  openedAt: Date;
};

export type AdminTodayNoShow = AdminTodayStudentAttention & {
  lessonId: string;
  enrollmentId: string;
  startsAt: Date;
  instructorName: string;
};

export type AdminTodayProjection = {
  timezone: typeof ADMIN_TODAY_TIMEZONE;
  generatedAt: Date;
  lessons: AdminTodayLesson[];
  upcomingExams: AdminTodayExam[];
  withoutNextLesson: AdminTodayEnrollmentAttention[];
  pendingFirstAccess: AdminTodayStudentAttention[];
  withoutGuide: AdminTodayEnrollmentAttention[];
  recentNoShows: AdminTodayNoShow[];
  summary: {
    lessonsToday: number;
    scheduledRemaining: number;
    withoutNextLesson: number;
    pendingFirstAccess: number;
    withoutGuide: number;
    recentNoShows: number;
    upcomingExams: number;
  };
};

const DAY_BOUNDS = `
  SELECT
    date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS day_start,
    (date_trunc('day', now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1 AS day_end
`;

export async function projectAdminToday(pool: pg.Pool): Promise<AdminTodayProjection> {
  const timezone = ADMIN_TODAY_TIMEZONE;

  const [lessonsResult, examsResult, withoutNextResult, pendingAccessResult, withoutGuideResult, noShowsResult] = await Promise.all([
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
      status: LessonStatus;
    }>(
      `WITH bounds AS (${DAY_BOUNDS})
       SELECT l.id, l.enrollment_id, l.student_id, s.public_id, s.full_name,
              i.display_name AS instructor_name, v.label AS vehicle_label,
              l.category, l.starts_at, l.ends_at, l.status
       FROM lessons l
       JOIN students s ON s.id = l.student_id
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       CROSS JOIN bounds b
       WHERE l.starts_at < b.day_end
         AND l.ends_at > b.day_start
       ORDER BY l.starts_at ASC, s.full_name ASC`,
      [timezone],
    ),
    pool.query<{
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      code: ExamCode;
      scheduled_for: Date;
    }>(
      `WITH bounds AS (${DAY_BOUNDS})
       SELECT m.enrollment_id, e.student_id, s.public_id, s.full_name, m.code, m.scheduled_for
       FROM enrollment_milestones m
       JOIN enrollments e ON e.id = m.enrollment_id
       JOIN students s ON s.id = e.student_id
       CROSS JOIN bounds b
       WHERE m.code IN ('THEORY_PASSED', 'PRACTICAL_EXAM_PASSED')
         AND m.achieved_at IS NULL
         AND m.scheduled_for >= b.day_start
         AND m.scheduled_for < b.day_start + interval '7 days'
         AND e.status = 'ACTIVE'
         AND s.status = 'ACTIVE'
       ORDER BY m.scheduled_for ASC, s.full_name ASC
       LIMIT 20`,
      [timezone],
    ),
    pool.query<{
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      service_type: AdminTodayEnrollmentAttention['serviceType'];
      category: AdminTodayEnrollmentAttention['category'];
      opened_at: Date;
    }>(
      `SELECT e.id AS enrollment_id, e.student_id, s.public_id, s.full_name,
              e.service_type, e.category, e.opened_at
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.status = 'ACTIVE'
         AND s.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1
           FROM lessons l
           WHERE l.enrollment_id = e.id
             AND l.student_id = e.student_id
             AND l.status = 'SCHEDULED'
             AND l.starts_at >= now()
         )
       ORDER BY e.opened_at ASC, s.full_name ASC
       LIMIT 30`,
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
         AND (
           c.student_id IS NULL
           OR (c.must_change_password = true AND c.disabled_at IS NULL)
         )
       ORDER BY s.full_name ASC
       LIMIT 30`,
    ),
    pool.query<{
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      service_type: AdminTodayEnrollmentAttention['serviceType'];
      category: AdminTodayEnrollmentAttention['category'];
      opened_at: Date;
    }>(
      `SELECT e.id AS enrollment_id, e.student_id, s.public_id, s.full_name,
              e.service_type, e.category, e.opened_at
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.status = 'ACTIVE'
         AND s.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM student_guides g WHERE g.enrollment_id = e.id
         )
       ORDER BY e.opened_at ASC, s.full_name ASC
       LIMIT 30`,
    ),
    pool.query<{
      lesson_id: string;
      enrollment_id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      starts_at: Date;
      instructor_name: string;
    }>(
      `SELECT l.id AS lesson_id, l.enrollment_id, l.student_id, s.public_id, s.full_name,
              l.starts_at, i.display_name AS instructor_name
       FROM lessons l
       JOIN students s ON s.id = l.student_id
       JOIN instructors i ON i.id = l.instructor_id
       WHERE l.status = 'NO_SHOW'
         AND l.starts_at >= now() - interval '7 days'
       ORDER BY l.starts_at DESC
       LIMIT 20`,
    ),
  ]);

  const lessons: AdminTodayLesson[] = lessonsResult.rows.map((row) => ({
    id: row.id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
    instructorName: row.instructor_name,
    vehicleLabel: row.vehicle_label,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  }));

  const upcomingExams: AdminTodayExam[] = examsResult.rows.map((row) => ({
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
    code: row.code,
    scheduledFor: row.scheduled_for,
  }));

  const mapEnrollment = (row: typeof withoutNextResult.rows[number]): AdminTodayEnrollmentAttention => ({
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
    serviceType: row.service_type,
    category: row.category,
    openedAt: row.opened_at,
  });

  const withoutNextLesson = withoutNextResult.rows.map(mapEnrollment);
  const withoutGuide = withoutGuideResult.rows.map((row) => mapEnrollment(row));
  const pendingFirstAccess = pendingAccessResult.rows.map((row) => ({
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
  }));
  const recentNoShows = noShowsResult.rows.map((row) => ({
    lessonId: row.lesson_id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
    startsAt: row.starts_at,
    instructorName: row.instructor_name,
  }));

  return {
    timezone,
    generatedAt: new Date(),
    lessons,
    upcomingExams,
    withoutNextLesson,
    pendingFirstAccess,
    withoutGuide,
    recentNoShows,
    summary: {
      lessonsToday: lessons.length,
      scheduledRemaining: lessons.filter((lesson) => lesson.status === 'SCHEDULED' && lesson.endsAt.getTime() > Date.now()).length,
      withoutNextLesson: withoutNextLesson.length,
      pendingFirstAccess: pendingFirstAccess.length,
      withoutGuide: withoutGuide.length,
      recentNoShows: recentNoShows.length,
      upcomingExams: upcomingExams.length,
    },
  };
}
