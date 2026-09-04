import type pg from 'pg';
import type { PhysicalCategory } from '../schedule/contracts.js';

export type StudentExamView = {
  candidateId: string;
  sessionId: string;
  enrollmentId: string;
  category: PhysicalCategory;
  locationLabel: string;
  sessionStartsAt: Date;
  sessionEndsAt: Date;
  officialScheduledFor: Date;
  sessionStatus: 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
  bookingSource: 'SELF' | 'SCHOOL';
  protocol: string | null;
  renach: string | null;
  feeStatus: 'UNKNOWN' | 'PENDING' | 'PAID';
  ladvStatus: 'UNKNOWN' | 'READY';
  attendanceStatus: 'PENDING' | 'PRESENT' | 'ABSENT';
  observedResult: 'PENDING' | 'APPROVED' | 'FAILED';
  officialResult: 'PENDING' | 'APPROVED' | 'FAILED';
  resultReconciledAt: Date | null;
  instructorName: string;
  vehicleLabel: string;
  vehiclePlate: string;
};

type ExamRow = {
  candidate_id: string;
  session_id: string;
  enrollment_id: string;
  category: PhysicalCategory;
  location_label: string;
  session_starts_at: Date;
  session_ends_at: Date;
  official_scheduled_for: Date;
  session_status: StudentExamView['sessionStatus'];
  booking_source: StudentExamView['bookingSource'];
  protocol: string | null;
  renach: string | null;
  fee_status: StudentExamView['feeStatus'];
  ladv_status: StudentExamView['ladvStatus'];
  attendance_status: StudentExamView['attendanceStatus'];
  observed_result: StudentExamView['observedResult'];
  official_result: StudentExamView['officialResult'];
  result_reconciled_at: Date | null;
  instructor_name: string;
  vehicle_label: string;
  vehicle_plate: string;
};

function mapExam(row: ExamRow): StudentExamView {
  return {
    candidateId: row.candidate_id,
    sessionId: row.session_id,
    enrollmentId: row.enrollment_id,
    category: row.category,
    locationLabel: row.location_label,
    sessionStartsAt: row.session_starts_at,
    sessionEndsAt: row.session_ends_at,
    officialScheduledFor: row.official_scheduled_for,
    sessionStatus: row.session_status,
    bookingSource: row.booking_source,
    protocol: row.protocol,
    renach: row.renach,
    feeStatus: row.fee_status,
    ladvStatus: row.ladv_status,
    attendanceStatus: row.attendance_status,
    observedResult: row.observed_result,
    officialResult: row.official_result,
    resultReconciledAt: row.result_reconciled_at,
    instructorName: row.instructor_name,
    vehicleLabel: row.vehicle_label,
    vehiclePlate: row.vehicle_plate,
  };
}

const EXAM_SELECT = `
  SELECT
    c.id AS candidate_id,
    c.session_id,
    c.enrollment_id,
    s.category,
    s.location_label,
    s.starts_at AS session_starts_at,
    s.ends_at AS session_ends_at,
    c.official_scheduled_for,
    s.status AS session_status,
    c.booking_source,
    c.protocol,
    c.renach,
    c.fee_status,
    c.ladv_status,
    c.attendance_status,
    c.observed_result,
    c.official_result,
    c.result_reconciled_at,
    i.display_name AS instructor_name,
    v.label AS vehicle_label,
    v.plate AS vehicle_plate
  FROM practical_exam_candidates c
  JOIN practical_exam_sessions s ON s.id = c.session_id
  JOIN enrollments e ON e.id = c.enrollment_id AND e.student_id = c.student_id
  JOIN instructors i ON i.id = s.instructor_id
  JOIN vehicles v ON v.id = s.vehicle_id
`;

export async function listStudentExams(
  pool: pg.Pool,
  studentId: string,
): Promise<StudentExamView[]> {
  const result = await pool.query<ExamRow>(
    `${EXAM_SELECT}
     WHERE c.student_id = $1
     ORDER BY c.official_scheduled_for DESC, c.created_at DESC`,
    [studentId],
  );
  return result.rows.map(mapExam);
}

export async function getStudentExam(
  pool: pg.Pool,
  studentId: string,
  candidateId: string,
): Promise<StudentExamView | null> {
  const result = await pool.query<ExamRow>(
    `${EXAM_SELECT}
     WHERE c.student_id = $1 AND c.id = $2
     LIMIT 1`,
    [studentId, candidateId],
  );
  return result.rows[0] ? mapExam(result.rows[0]) : null;
}
