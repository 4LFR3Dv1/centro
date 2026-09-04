import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { resolveEnrollmentProcess } from '../process/resolver.js';

export type ExamCategory = 'A' | 'B' | 'D';
export type ExamSessionStatus = 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
export type ExamBookingSource = 'SELF' | 'SCHOOL';
export type ExamFeeStatus = 'UNKNOWN' | 'PENDING' | 'PAID';
export type ExamLadvStatus = 'UNKNOWN' | 'READY';
export type ExamAttendanceStatus = 'PENDING' | 'PRESENT' | 'ABSENT';
export type ExamResult = 'PENDING' | 'APPROVED' | 'FAILED';

export class ExamInputError extends Error {}
export class ExamConflictError extends Error {}

export type ExamSessionSummary = {
  id: string;
  category: ExamCategory;
  locationLabel: string;
  startsAt: Date;
  endsAt: Date;
  instructorId: string;
  instructorName: string;
  vehicleId: string;
  vehicleLabel: string;
  vehiclePlate: string;
  status: ExamSessionStatus;
  notes: string | null;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  failedCount: number;
};

export type ExamCandidateView = {
  id: string;
  sessionId: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  phone: string;
  documentMasked: string | null;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  enrollmentCategory: 'A' | 'B' | 'AB' | 'D';
  officialScheduledFor: Date;
  bookingSource: ExamBookingSource;
  protocol: string | null;
  renach: string | null;
  feeStatus: ExamFeeStatus;
  ladvStatus: ExamLadvStatus;
  attendanceStatus: ExamAttendanceStatus;
  observedResult: ExamResult;
  officialResult: ExamResult;
  resultReconciledAt: Date | null;
};

export type ExamSessionDetail = ExamSessionSummary & {
  candidates: ExamCandidateView[];
};

export type ExamOptions = {
  instructors: Array<{
    id: string;
    displayName: string;
    categories: ExamCategory[];
  }>;
  vehicles: Array<{
    id: string;
    plate: string;
    label: string;
    category: ExamCategory;
  }>;
  enrollments: Array<{
    id: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    phone: string;
    serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
    category: 'A' | 'B' | 'AB' | 'D';
    practiceDone: boolean;
  }>;
};

type Queryable = pg.Pool | pg.PoolClient;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ExamInputError(`${label} é obrigatório.`);
  return normalized;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function asDate(value: string | Date, label: string): Date {
  const candidate = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(candidate.getTime())) throw new ExamInputError(`${label} é inválido.`);
  return candidate;
}

function assertCategory(value: string): asserts value is ExamCategory {
  if (value !== 'A' && value !== 'B' && value !== 'D') {
    throw new ExamInputError('Categoria do exame deve ser A, B ou D.');
  }
}

function assertBookingSource(value: string): asserts value is ExamBookingSource {
  if (value !== 'SELF' && value !== 'SCHOOL') throw new ExamInputError('Origem do agendamento inválida.');
}

function assertFeeStatus(value: string): asserts value is ExamFeeStatus {
  if (value !== 'UNKNOWN' && value !== 'PENDING' && value !== 'PAID') throw new ExamInputError('Status da taxa inválido.');
}

function assertLadvStatus(value: string): asserts value is ExamLadvStatus {
  if (value !== 'UNKNOWN' && value !== 'READY') throw new ExamInputError('Status da LADV inválido.');
}

function assertAttendance(value: string): asserts value is ExamAttendanceStatus {
  if (value !== 'PENDING' && value !== 'PRESENT' && value !== 'ABSENT') throw new ExamInputError('Presença inválida.');
}

function assertFinalResult(value: string): asserts value is Exclude<ExamResult, 'PENDING'> {
  if (value !== 'APPROVED' && value !== 'FAILED') throw new ExamInputError('Resultado deve ser APPROVED ou FAILED.');
}

async function insertAudit(
  client: pg.PoolClient,
  actorStaffUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'STAFF', $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorStaffUserId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

function mapSummary(row: {
  id: string;
  category: ExamCategory;
  location_label: string;
  starts_at: Date;
  ends_at: Date;
  instructor_id: string;
  instructor_name: string;
  vehicle_id: string;
  vehicle_label: string;
  vehicle_plate: string;
  status: ExamSessionStatus;
  notes: string | null;
  candidate_count: number;
  pending_count: number;
  approved_count: number;
  failed_count: number;
}): ExamSessionSummary {
  return {
    id: row.id,
    category: row.category,
    locationLabel: row.location_label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    instructorId: row.instructor_id,
    instructorName: row.instructor_name,
    vehicleId: row.vehicle_id,
    vehicleLabel: row.vehicle_label,
    vehiclePlate: row.vehicle_plate,
    status: row.status,
    notes: row.notes,
    candidateCount: row.candidate_count,
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    failedCount: row.failed_count,
  };
}

const SUMMARY_SELECT = `
  SELECT x.id, x.category, x.location_label, x.starts_at, x.ends_at,
         x.instructor_id, i.display_name AS instructor_name,
         x.vehicle_id, v.label AS vehicle_label, v.plate AS vehicle_plate,
         x.status, x.notes,
         count(c.id)::int AS candidate_count,
         count(c.id) FILTER (WHERE c.official_result = 'PENDING')::int AS pending_count,
         count(c.id) FILTER (WHERE c.official_result = 'APPROVED')::int AS approved_count,
         count(c.id) FILTER (WHERE c.official_result = 'FAILED')::int AS failed_count
  FROM practical_exam_sessions x
  JOIN instructors i ON i.id = x.instructor_id
  JOIN vehicles v ON v.id = x.vehicle_id
  LEFT JOIN practical_exam_candidates c ON c.session_id = x.id
`;

const SUMMARY_GROUP = `
  GROUP BY x.id, i.id, v.id
`;

export async function getExamOptions(pool: pg.Pool): Promise<ExamOptions> {
  const [instructorsResult, vehiclesResult, enrollmentsResult] = await Promise.all([
    pool.query<{
      id: string;
      display_name: string;
      categories: string[];
    }>(
      `SELECT i.id, i.display_name,
              COALESCE(array_agg(ic.category ORDER BY ic.category) FILTER (WHERE ic.category IS NOT NULL), ARRAY[]::text[]) AS categories
       FROM instructors i
       LEFT JOIN instructor_categories ic ON ic.instructor_id = i.id
       WHERE i.active = true
       GROUP BY i.id
       ORDER BY i.display_name ASC`,
    ),
    pool.query<{ id: string; plate: string; label: string; category: ExamCategory }>(
      `SELECT id, plate, label, category
       FROM vehicles
       WHERE active = true
       ORDER BY category ASC, label ASC`,
    ),
    pool.query<{
      id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      phone: string;
      service_type: ExamOptions['enrollments'][number]['serviceType'];
      category: ExamOptions['enrollments'][number]['category'];
      practice_done: boolean;
    }>(
      `SELECT e.id, e.student_id, s.public_id, s.full_name, s.phone, e.service_type, e.category,
              EXISTS (
                SELECT 1 FROM enrollment_milestones m
                WHERE m.enrollment_id = e.id AND m.code = 'PRACTICE_DONE' AND m.achieved_at IS NOT NULL
              ) AS practice_done
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.status = 'ACTIVE'
         AND s.status = 'ACTIVE'
         AND (
           e.service_type <> 'FIRST_LICENSE'
           OR EXISTS (
             SELECT 1 FROM enrollment_milestones m
             WHERE m.enrollment_id = e.id AND m.code = 'PRACTICE_DONE' AND m.achieved_at IS NOT NULL
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM enrollment_milestones m
           WHERE m.enrollment_id = e.id AND m.code = 'PRACTICAL_EXAM_PASSED' AND m.achieved_at IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1
           FROM practical_exam_candidates c
           JOIN practical_exam_sessions x ON x.id = c.session_id
           WHERE c.enrollment_id = e.id
             AND c.official_result = 'PENDING'
             AND x.status IN ('PLANNED', 'CONFIRMED')
         )
       ORDER BY s.full_name ASC, e.opened_at DESC`,
    ),
  ]);

  return {
    instructors: instructorsResult.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      categories: row.categories.filter((category): category is ExamCategory => category === 'A' || category === 'B' || category === 'D'),
    })),
    vehicles: vehiclesResult.rows,
    enrollments: enrollmentsResult.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      phone: row.phone,
      serviceType: row.service_type,
      category: row.category,
      practiceDone: row.practice_done,
    })),
  };
}

export async function listPracticalExamSessions(
  pool: pg.Pool,
  input: { from: string | Date; to: string | Date },
): Promise<ExamSessionSummary[]> {
  const from = asDate(input.from, 'Início do período');
  const to = asDate(input.to, 'Fim do período');
  if (to.getTime() <= from.getTime()) throw new ExamInputError('Período de exames inválido.');
  if (to.getTime() - from.getTime() > 120 * 24 * 60 * 60 * 1000) {
    throw new ExamInputError('A consulta pode cobrir no máximo 120 dias.');
  }
  const result = await pool.query<Parameters<typeof mapSummary>[0]>(
    `${SUMMARY_SELECT}
     WHERE x.starts_at < $2 AND x.ends_at > $1
     ${SUMMARY_GROUP}
     ORDER BY x.starts_at ASC, x.category ASC`,
    [from, to],
  );
  return result.rows.map(mapSummary);
}

export async function getPracticalExamSession(db: Queryable, sessionId: string): Promise<ExamSessionDetail | null> {
  const summaryResult = await db.query<Parameters<typeof mapSummary>[0]>(
    `${SUMMARY_SELECT}
     WHERE x.id = $1
     ${SUMMARY_GROUP}`,
    [sessionId],
  );
  const summaryRow = summaryResult.rows[0];
  if (!summaryRow) return null;

  const candidateResult = await db.query<{
    id: string;
    session_id: string;
    enrollment_id: string;
    student_id: string;
    public_id: string;
    full_name: string;
    phone: string;
    document_masked: string | null;
    service_type: ExamCandidateView['serviceType'];
    enrollment_category: ExamCandidateView['enrollmentCategory'];
    official_scheduled_for: Date;
    booking_source: ExamBookingSource;
    protocol: string | null;
    renach: string | null;
    fee_status: ExamFeeStatus;
    ladv_status: ExamLadvStatus;
    attendance_status: ExamAttendanceStatus;
    observed_result: ExamResult;
    official_result: ExamResult;
    result_reconciled_at: Date | null;
  }>(
    `SELECT c.id, c.session_id, c.enrollment_id, c.student_id,
            s.public_id, s.full_name, s.phone,
            CASE
              WHEN s.document_normalized IS NULL THEN NULL
              WHEN length(s.document_normalized) <= 4 THEN s.document_normalized
              ELSE repeat('•', length(s.document_normalized) - 4) || right(s.document_normalized, 4)
            END AS document_masked,
            e.service_type, e.category AS enrollment_category,
            c.official_scheduled_for, c.booking_source, c.protocol, c.renach,
            c.fee_status, c.ladv_status, c.attendance_status,
            c.observed_result, c.official_result, c.result_reconciled_at
     FROM practical_exam_candidates c
     JOIN enrollments e ON e.id = c.enrollment_id
     JOIN students s ON s.id = c.student_id
     WHERE c.session_id = $1
     ORDER BY c.official_scheduled_for ASC, s.full_name ASC`,
    [sessionId],
  );

  return {
    ...mapSummary(summaryRow),
    candidates: candidateResult.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      enrollmentId: row.enrollment_id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      phone: row.phone,
      documentMasked: row.document_masked,
      serviceType: row.service_type,
      enrollmentCategory: row.enrollment_category,
      officialScheduledFor: row.official_scheduled_for,
      bookingSource: row.booking_source,
      protocol: row.protocol,
      renach: row.renach,
      feeStatus: row.fee_status,
      ladvStatus: row.ladv_status,
      attendanceStatus: row.attendance_status,
      observedResult: row.observed_result,
      officialResult: row.official_result,
      resultReconciledAt: row.result_reconciled_at,
    })),
  };
}

export async function createPracticalExamSession(
  pool: pg.Pool,
  input: {
    category: string;
    locationLabel: string;
    startsAt: string | Date;
    endsAt: string | Date;
    instructorId: string;
    vehicleId: string;
    notes?: string | null;
    actorStaffUserId: string;
  },
): Promise<ExamSessionDetail> {
  assertCategory(input.category);
  const locationLabel = required(input.locationLabel, 'Local/banca');
  const instructorId = required(input.instructorId, 'Instrutor responsável');
  const vehicleId = required(input.vehicleId, 'Veículo');
  const startsAt = asDate(input.startsAt, 'Início da lista');
  const endsAt = asDate(input.endsAt, 'Fim da lista');
  if (endsAt.getTime() <= startsAt.getTime()) throw new ExamInputError('O fim da lista deve ser posterior ao início.');
  if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000) throw new ExamInputError('Uma lista de exame não pode cobrir mais de 24 horas.');
  if (endsAt.getTime() <= Date.now()) throw new ExamInputError('A lista precisa terminar no futuro.');

  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO practical_exam_sessions(
         id, category, location_label, starts_at, ends_at,
         instructor_id, vehicle_id, notes, created_by_staff_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.category, locationLabel, startsAt, endsAt, instructorId, vehicleId, optional(input.notes), input.actorStaffUserId],
    );
    await insertAudit(client, input.actorStaffUserId, 'EXAM_SESSION_CREATED', 'PracticalExamSession', id, {
      category: input.category,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    const detail = await getPracticalExamSession(client, id);
    if (!detail) throw new Error('Practical exam session disappeared during creation.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

async function upsertPracticalExamSchedule(
  client: pg.PoolClient,
  enrollmentId: string,
  scheduledFor: Date,
  actorStaffUserId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO enrollment_milestones(
       id, enrollment_id, code, scheduled_for, updated_by_staff_user_id, note
     ) VALUES ($1, $2, 'PRACTICAL_EXAM_PASSED', $3, $4, 'Agendamento vinculado à lista operacional de exame.')
     ON CONFLICT (enrollment_id, code) DO UPDATE SET
       scheduled_for = EXCLUDED.scheduled_for,
       updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
       updated_at = now()`,
    [randomUUID(), enrollmentId, scheduledFor, actorStaffUserId],
  );
}

export async function addPracticalExamCandidate(
  pool: pg.Pool,
  input: {
    sessionId: string;
    enrollmentId: string;
    officialScheduledFor: string | Date;
    bookingSource: string;
    protocol?: string | null;
    renach?: string | null;
    feeStatus?: string;
    ladvStatus?: string;
    actorStaffUserId: string;
  },
): Promise<ExamSessionDetail> {
  const sessionId = required(input.sessionId, 'Lista de exame');
  const enrollmentId = required(input.enrollmentId, 'Matrícula');
  const officialScheduledFor = asDate(input.officialScheduledFor, 'Horário oficial');
  assertBookingSource(input.bookingSource);
  const feeStatus = input.feeStatus || 'UNKNOWN';
  const ladvStatus = input.ladvStatus || 'UNKNOWN';
  assertFeeStatus(feeStatus);
  assertLadvStatus(ladvStatus);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query<{ status: ExamSessionStatus }>(
      'SELECT status FROM practical_exam_sessions WHERE id = $1 FOR UPDATE',
      [sessionId],
    );
    if (!session.rows[0]) throw new ExamInputError('Lista de exame não encontrada.');
    if (!['PLANNED', 'CONFIRMED'].includes(session.rows[0].status)) throw new ExamConflictError('Esta lista não aceita novos alunos.');

    const enrollment = await client.query<{ student_id: string }>(
      'SELECT student_id FROM enrollments WHERE id = $1',
      [enrollmentId],
    );
    const studentId = enrollment.rows[0]?.student_id;
    if (!studentId) throw new ExamInputError('Matrícula não encontrada.');

    const candidateId = randomUUID();
    await client.query(
      `INSERT INTO practical_exam_candidates(
         id, session_id, enrollment_id, student_id, official_scheduled_for,
         booking_source, protocol, renach, fee_status, ladv_status,
         created_by_staff_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        candidateId,
        sessionId,
        enrollmentId,
        studentId,
        officialScheduledFor,
        input.bookingSource,
        optional(input.protocol),
        optional(input.renach),
        feeStatus,
        ladvStatus,
        input.actorStaffUserId,
      ],
    );
    await upsertPracticalExamSchedule(client, enrollmentId, officialScheduledFor, input.actorStaffUserId);
    await insertAudit(client, input.actorStaffUserId, 'EXAM_CANDIDATE_ADDED', 'PracticalExamCandidate', candidateId, {
      sessionId,
      enrollmentId,
      officialScheduledFor: officialScheduledFor.toISOString(),
      bookingSource: input.bookingSource,
    });

    const detail = await getPracticalExamSession(client, sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while adding candidate.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePracticalExamCandidateDetails(
  pool: pg.Pool,
  input: {
    sessionId: string;
    candidateId: string;
    officialScheduledFor: string | Date;
    bookingSource: string;
    protocol?: string | null;
    renach?: string | null;
    feeStatus: string;
    ladvStatus: string;
    actorStaffUserId: string;
  },
): Promise<ExamSessionDetail> {
  const officialScheduledFor = asDate(input.officialScheduledFor, 'Horário oficial');
  assertBookingSource(input.bookingSource);
  assertFeeStatus(input.feeStatus);
  assertLadvStatus(input.ladvStatus);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      enrollment_id: string;
      official_result: ExamResult;
      session_status: ExamSessionStatus;
    }>(
      `SELECT c.enrollment_id, c.official_result, x.status AS session_status
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions x ON x.id = c.session_id
       WHERE c.id = $1 AND c.session_id = $2
       FOR UPDATE OF c`,
      [input.candidateId, input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Aluno não encontrado nesta lista.');
    if (!['PLANNED', 'CONFIRMED'].includes(row.session_status)) throw new ExamConflictError('Lista encerrada não pode ser editada.');
    if (row.official_result !== 'PENDING') throw new ExamConflictError('Resultado oficial já reconciliado; os dados do exame não podem ser alterados.');

    await client.query(
      `UPDATE practical_exam_candidates
       SET official_scheduled_for = $3,
           booking_source = $4,
           protocol = $5,
           renach = $6,
           fee_status = $7,
           ladv_status = $8,
           updated_at = now()
       WHERE id = $1 AND session_id = $2`,
      [
        input.candidateId,
        input.sessionId,
        officialScheduledFor,
        input.bookingSource,
        optional(input.protocol),
        optional(input.renach),
        input.feeStatus,
        input.ladvStatus,
      ],
    );
    await upsertPracticalExamSchedule(client, row.enrollment_id, officialScheduledFor, input.actorStaffUserId);
    await insertAudit(client, input.actorStaffUserId, 'EXAM_CANDIDATE_UPDATED', 'PracticalExamCandidate', input.candidateId, {
      sessionId: input.sessionId,
      officialScheduledFor: officialScheduledFor.toISOString(),
    });
    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while updating candidate.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function removePracticalExamCandidate(
  pool: pg.Pool,
  input: { sessionId: string; candidateId: string; actorStaffUserId: string },
): Promise<ExamSessionDetail> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      enrollment_id: string;
      official_scheduled_for: Date;
      attendance_status: ExamAttendanceStatus;
      observed_result: ExamResult;
      official_result: ExamResult;
      session_status: ExamSessionStatus;
    }>(
      `SELECT c.enrollment_id, c.official_scheduled_for, c.attendance_status, c.observed_result, c.official_result,
              x.status AS session_status
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions x ON x.id = c.session_id
       WHERE c.id = $1 AND c.session_id = $2
       FOR UPDATE OF c`,
      [input.candidateId, input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Aluno não encontrado nesta lista.');
    if (!['PLANNED', 'CONFIRMED'].includes(row.session_status)) throw new ExamConflictError('Lista encerrada não pode remover alunos.');
    if (row.attendance_status !== 'PENDING' || row.observed_result !== 'PENDING' || row.official_result !== 'PENDING') {
      throw new ExamConflictError('Aluno com presença ou resultado registrado não pode ser removido da lista.');
    }

    await insertAudit(client, input.actorStaffUserId, 'EXAM_CANDIDATE_REMOVED', 'PracticalExamCandidate', input.candidateId, {
      sessionId: input.sessionId,
      enrollmentId: row.enrollment_id,
    });
    await client.query('DELETE FROM practical_exam_candidates WHERE id = $1', [input.candidateId]);
    await client.query(
      `UPDATE enrollment_milestones
       SET scheduled_for = NULL,
           updated_by_staff_user_id = $3,
           updated_at = now()
       WHERE enrollment_id = $1
         AND code = 'PRACTICAL_EXAM_PASSED'
         AND achieved_at IS NULL
         AND scheduled_for = $2`,
      [row.enrollment_id, row.official_scheduled_for, input.actorStaffUserId],
    );
    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while removing candidate.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function recordPracticalExamAttendance(
  pool: pg.Pool,
  input: { sessionId: string; candidateId: string; attendanceStatus: string; actorStaffUserId: string },
): Promise<ExamSessionDetail> {
  assertAttendance(input.attendanceStatus);
  if (input.attendanceStatus === 'PENDING') throw new ExamInputError('Registre PRESENT ou ABSENT.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ official_result: ExamResult; session_status: ExamSessionStatus }>(
      `SELECT c.official_result, x.status AS session_status
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions x ON x.id = c.session_id
       WHERE c.id = $1 AND c.session_id = $2
       FOR UPDATE OF c`,
      [input.candidateId, input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Aluno não encontrado nesta lista.');
    if (!['PLANNED', 'CONFIRMED'].includes(row.session_status)) throw new ExamConflictError('Lista encerrada não pode registrar presença.');
    if (row.official_result !== 'PENDING') throw new ExamConflictError('Resultado oficial já reconciliado.');

    await client.query(
      `UPDATE practical_exam_candidates
       SET attendance_status = $3,
           observed_result = CASE WHEN $3 = 'ABSENT' THEN 'PENDING' ELSE observed_result END,
           updated_at = now()
       WHERE id = $1 AND session_id = $2`,
      [input.candidateId, input.sessionId, input.attendanceStatus],
    );
    await insertAudit(client, input.actorStaffUserId, 'EXAM_ATTENDANCE_RECORDED', 'PracticalExamCandidate', input.candidateId, {
      sessionId: input.sessionId,
      attendanceStatus: input.attendanceStatus,
    });
    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while recording attendance.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function recordPracticalExamObservedResult(
  pool: pg.Pool,
  input: { sessionId: string; candidateId: string; result: string; actorStaffUserId: string },
): Promise<ExamSessionDetail> {
  assertFinalResult(input.result);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      attendance_status: ExamAttendanceStatus;
      official_result: ExamResult;
      session_status: ExamSessionStatus;
    }>(
      `SELECT c.attendance_status, c.official_result, x.status AS session_status
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions x ON x.id = c.session_id
       WHERE c.id = $1 AND c.session_id = $2
       FOR UPDATE OF c`,
      [input.candidateId, input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Aluno não encontrado nesta lista.');
    if (!['PLANNED', 'CONFIRMED'].includes(row.session_status)) throw new ExamConflictError('Lista encerrada não pode registrar resultado.');
    if (row.attendance_status !== 'PRESENT') throw new ExamConflictError('Resultado só pode ser observado depois de registrar presença.');
    if (row.official_result !== 'PENDING') throw new ExamConflictError('Resultado oficial já reconciliado.');

    await client.query(
      `UPDATE practical_exam_candidates
       SET observed_result = $3, updated_at = now()
       WHERE id = $1 AND session_id = $2`,
      [input.candidateId, input.sessionId, input.result],
    );
    await insertAudit(client, input.actorStaffUserId, 'EXAM_RESULT_OBSERVED', 'PracticalExamCandidate', input.candidateId, {
      sessionId: input.sessionId,
      result: input.result,
    });
    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while observing result.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcilePracticalExamOfficialResult(
  pool: pg.Pool,
  input: { sessionId: string; candidateId: string; result: string; actorStaffUserId: string },
): Promise<ExamSessionDetail> {
  assertFinalResult(input.result);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      enrollment_id: string;
      service_type: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
      attendance_status: ExamAttendanceStatus;
      observed_result: ExamResult;
      official_result: ExamResult;
      session_status: ExamSessionStatus;
    }>(
      `SELECT c.enrollment_id, e.service_type, c.attendance_status, c.observed_result, c.official_result,
              x.status AS session_status
       FROM practical_exam_candidates c
       JOIN practical_exam_sessions x ON x.id = c.session_id
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE c.id = $1 AND c.session_id = $2
       FOR UPDATE OF c, e`,
      [input.candidateId, input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Aluno não encontrado nesta lista.');
    if (!['PLANNED', 'CONFIRMED'].includes(row.session_status)) throw new ExamConflictError('Lista encerrada não pode reconciliar resultado.');
    if (row.attendance_status !== 'PRESENT') throw new ExamConflictError('Resultado oficial exige presença registrada.');
    if (row.observed_result === 'PENDING') throw new ExamConflictError('Registre primeiro o resultado observado pela escola.');
    if (row.official_result !== 'PENDING') throw new ExamConflictError('Resultado oficial já foi reconciliado e é imutável neste corte.');

    if (input.result === 'APPROVED' && row.service_type === 'FIRST_LICENSE') {
      const process = await resolveEnrollmentProcess(client, row.enrollment_id);
      if (!process || !process.modeled) throw new ExamConflictError('Processo institucional não disponível para reconciliar a aprovação.');
      if (process.currentState.code !== 'PRACTICAL_EXAM_PASSED') {
        throw new ExamConflictError(`A aprovação não pode avançar o processo enquanto a etapa atual for ${process.currentState.code}.`);
      }
    }

    await client.query(
      `UPDATE practical_exam_candidates
       SET official_result = $3,
           result_reconciled_at = now(),
           updated_at = now()
       WHERE id = $1 AND session_id = $2`,
      [input.candidateId, input.sessionId, input.result],
    );

    if (input.result === 'APPROVED') {
      await client.query(
        `INSERT INTO enrollment_milestones(
           id, enrollment_id, code, scheduled_for, achieved_at,
           achieved_by_staff_user_id, updated_by_staff_user_id, note
         )
         SELECT $1, c.enrollment_id, 'PRACTICAL_EXAM_PASSED', c.official_scheduled_for, now(), $4, $4,
                'Aprovação oficial reconciliada a partir da lista operacional de exame.'
         FROM practical_exam_candidates c
         WHERE c.id = $2 AND c.session_id = $3
         ON CONFLICT (enrollment_id, code) DO UPDATE SET
           achieved_at = now(),
           achieved_by_staff_user_id = EXCLUDED.achieved_by_staff_user_id,
           updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
           note = EXCLUDED.note,
           updated_at = now()`,
        [randomUUID(), input.candidateId, input.sessionId, input.actorStaffUserId],
      );
      await insertAudit(client, input.actorStaffUserId, 'PROCESS_MILESTONE_ACHIEVED', 'ENROLLMENT', row.enrollment_id, {
        code: 'PRACTICAL_EXAM_PASSED',
        source: 'practical_exam_official_result',
        candidateId: input.candidateId,
      });
    }

    await insertAudit(client, input.actorStaffUserId, 'EXAM_RESULT_RECONCILED', 'PracticalExamCandidate', input.candidateId, {
      sessionId: input.sessionId,
      observedResult: row.observed_result,
      officialResult: input.result,
      divergedFromObservation: row.observed_result !== input.result,
    });

    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared while reconciling result.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

const ALLOWED_TRANSITIONS: Record<ExamSessionStatus, ExamSessionStatus[]> = {
  PLANNED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export async function setPracticalExamSessionStatus(
  pool: pg.Pool,
  input: { sessionId: string; status: string; actorStaffUserId: string },
): Promise<ExamSessionDetail> {
  if (!['PLANNED', 'CONFIRMED', 'CLOSED', 'CANCELLED'].includes(input.status)) throw new ExamInputError('Status da lista inválido.');
  const requested = input.status as ExamSessionStatus;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: ExamSessionStatus }>(
      'SELECT status FROM practical_exam_sessions WHERE id = $1 FOR UPDATE',
      [input.sessionId],
    );
    const row = current.rows[0];
    if (!row) throw new ExamInputError('Lista de exame não encontrada.');
    if (!ALLOWED_TRANSITIONS[row.status].includes(requested)) {
      throw new ExamConflictError(`Transição ${row.status} → ${requested} não é permitida.`);
    }

    if (requested === 'CONFIRMED') {
      const count = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM practical_exam_candidates WHERE session_id = $1',
        [input.sessionId],
      );
      if ((count.rows[0]?.total ?? 0) < 1) throw new ExamConflictError('Inclua ao menos um aluno antes de confirmar a lista.');
    }

    if (requested === 'CLOSED') {
      const unresolved = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM practical_exam_candidates
         WHERE session_id = $1
           AND (
             attendance_status = 'PENDING'
             OR (attendance_status = 'PRESENT' AND official_result = 'PENDING')
           )`,
        [input.sessionId],
      );
      if ((unresolved.rows[0]?.total ?? 0) > 0) {
        throw new ExamConflictError('Resolva presença e resultado oficial dos presentes antes de encerrar a lista.');
      }
    }

    if (requested === 'CANCELLED') {
      const reconciled = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM practical_exam_candidates
         WHERE session_id = $1 AND official_result <> 'PENDING'`,
        [input.sessionId],
      );
      if ((reconciled.rows[0]?.total ?? 0) > 0) throw new ExamConflictError('Lista com resultado oficial reconciliado não pode ser cancelada.');

      await client.query(
        `UPDATE enrollment_milestones m
         SET scheduled_for = NULL,
             updated_by_staff_user_id = $2,
             updated_at = now()
         FROM practical_exam_candidates c
         WHERE c.session_id = $1
           AND c.enrollment_id = m.enrollment_id
           AND m.code = 'PRACTICAL_EXAM_PASSED'
           AND m.achieved_at IS NULL
           AND m.scheduled_for = c.official_scheduled_for`,
        [input.sessionId, input.actorStaffUserId],
      );
    }

    await client.query(
      'UPDATE practical_exam_sessions SET status = $2, updated_at = now() WHERE id = $1',
      [input.sessionId, requested],
    );
    await insertAudit(client, input.actorStaffUserId, 'EXAM_SESSION_STATUS_CHANGED', 'PracticalExamSession', input.sessionId, {
      from: row.status,
      to: requested,
    });
    const detail = await getPracticalExamSession(client, input.sessionId);
    if (!detail) throw new Error('Practical exam session disappeared during status transition.');
    await client.query('COMMIT');
    return detail;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}
