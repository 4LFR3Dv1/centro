import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { resolveEnrollmentProcess } from '../process/resolver.js';

export type TheoryExamBookingSource = 'SELF' | 'SCHOOL';
export type TheoryExamAttendance = 'PENDING' | 'PRESENT' | 'ABSENT';
export type TheoryExamResult = 'PENDING' | 'APPROVED' | 'FAILED';

export class TheoryExamInputError extends Error {}
export class TheoryExamConflictError extends Error {}

export type TheoryExamAttempt = {
  id: string;
  enrollmentId: string;
  studentId: string;
  scheduledFor: Date;
  bookingSource: TheoryExamBookingSource;
  protocol: string | null;
  attendanceStatus: TheoryExamAttendance;
  observedResult: TheoryExamResult;
  officialResult: TheoryExamResult;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Queryable = pg.Pool | pg.PoolClient;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TheoryExamInputError(`${label} é obrigatório.`);
  return normalized;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function asDate(value: string | Date, label: string): Date {
  const candidate = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(candidate.getTime())) throw new TheoryExamInputError(`${label} é inválido.`);
  return candidate;
}

function assertBookingSource(value: string): asserts value is TheoryExamBookingSource {
  if (value !== 'SELF' && value !== 'SCHOOL') throw new TheoryExamInputError('Origem do agendamento inválida.');
}

function assertAttendance(value: string): asserts value is Exclude<TheoryExamAttendance, 'PENDING'> {
  if (value !== 'PRESENT' && value !== 'ABSENT') throw new TheoryExamInputError('Presença deve ser PRESENT ou ABSENT.');
}

function assertFinalResult(value: string): asserts value is Exclude<TheoryExamResult, 'PENDING'> {
  if (value !== 'APPROVED' && value !== 'FAILED') throw new TheoryExamInputError('Resultado deve ser APPROVED ou FAILED.');
}

function mapAttempt(row: {
  id: string;
  enrollment_id: string;
  student_id: string;
  scheduled_for: Date;
  booking_source: TheoryExamBookingSource;
  protocol: string | null;
  attendance_status: TheoryExamAttendance;
  observed_result: TheoryExamResult;
  official_result: TheoryExamResult;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): TheoryExamAttempt {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    scheduledFor: row.scheduled_for,
    bookingSource: row.booking_source,
    protocol: row.protocol,
    attendanceStatus: row.attendance_status,
    observedResult: row.observed_result,
    officialResult: row.official_result,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ATTEMPT_SELECT = `
  SELECT id, enrollment_id, student_id, scheduled_for, booking_source, protocol,
         attendance_status, observed_result, official_result, resolved_at, created_at, updated_at
  FROM theory_exam_attempts
`;

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

async function syncTheorySchedule(
  client: pg.PoolClient,
  enrollmentId: string,
  scheduledFor: Date | null,
  actorStaffUserId: string,
  note: string,
): Promise<void> {
  await client.query(
    `INSERT INTO enrollment_milestones(
       id, enrollment_id, code, scheduled_for, updated_by_staff_user_id, note
     ) VALUES ($1, $2, 'THEORY_PASSED', $3, $4, $5)
     ON CONFLICT (enrollment_id, code) DO UPDATE SET
       scheduled_for = EXCLUDED.scheduled_for,
       updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
       note = EXCLUDED.note,
       updated_at = now()
     WHERE enrollment_milestones.achieved_at IS NULL`,
    [randomUUID(), enrollmentId, scheduledFor, actorStaffUserId, note],
  );
}

export async function getTheoryExamAttempt(db: Queryable, attemptId: string): Promise<TheoryExamAttempt | null> {
  const result = await db.query<Parameters<typeof mapAttempt>[0]>(`${ATTEMPT_SELECT} WHERE id = $1`, [attemptId]);
  return result.rows[0] ? mapAttempt(result.rows[0]) : null;
}

export async function getOpenTheoryExamAttempt(db: Queryable, enrollmentId: string): Promise<TheoryExamAttempt | null> {
  const result = await db.query<Parameters<typeof mapAttempt>[0]>(
    `${ATTEMPT_SELECT} WHERE enrollment_id = $1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [enrollmentId],
  );
  return result.rows[0] ? mapAttempt(result.rows[0]) : null;
}

export async function listTheoryExamAttempts(db: Queryable, enrollmentId: string): Promise<TheoryExamAttempt[]> {
  const result = await db.query<Parameters<typeof mapAttempt>[0]>(
    `${ATTEMPT_SELECT} WHERE enrollment_id = $1 ORDER BY scheduled_for DESC, created_at DESC`,
    [enrollmentId],
  );
  return result.rows.map(mapAttempt);
}

export async function createTheoryExamAttempt(
  pool: pg.Pool,
  input: {
    enrollmentId: string;
    scheduledFor: string | Date;
    bookingSource?: string;
    protocol?: string | null;
    actorStaffUserId: string;
  },
): Promise<TheoryExamAttempt> {
  const enrollmentId = required(input.enrollmentId, 'Matrícula');
  const scheduledFor = asDate(input.scheduledFor, 'Data da prova');
  if (scheduledFor.getTime() <= Date.now()) throw new TheoryExamInputError('A prova teórica precisa ser agendada no futuro.');
  const bookingSource = input.bookingSource || 'SCHOOL';
  assertBookingSource(bookingSource);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE', [enrollmentId]);
    const process = await resolveEnrollmentProcess(client, enrollmentId);
    if (!process) throw new TheoryExamInputError('Matrícula não encontrada.');
    if (!process.modeled || process.enrollment.serviceType !== 'FIRST_LICENSE') {
      throw new TheoryExamConflictError('THEORY-EXAM-001 só admite primeira habilitação neste corte.');
    }
    if (process.enrollment.status !== 'ACTIVE' || process.currentState.code !== 'THEORY_PASSED') {
      throw new TheoryExamConflictError(`A prova teórica só pode ser criada quando a etapa atual for THEORY_PASSED.`);
    }

    const studentId = process.enrollment.studentId;
    const id = randomUUID();
    await client.query(
      `INSERT INTO theory_exam_attempts(
         id, enrollment_id, student_id, scheduled_for, booking_source, protocol,
         created_by_staff_user_id, updated_by_staff_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [id, enrollmentId, studentId, scheduledFor, bookingSource, optional(input.protocol), input.actorStaffUserId],
    );
    await syncTheorySchedule(client, enrollmentId, scheduledFor, input.actorStaffUserId, 'Agendamento vinculado à tentativa operacional de prova teórica.');
    await insertAudit(client, input.actorStaffUserId, 'THEORY_EXAM_ATTEMPT_CREATED', 'TheoryExamAttempt', id, {
      enrollmentId,
      scheduledFor: scheduledFor.toISOString(),
      bookingSource,
    });
    await insertAudit(client, input.actorStaffUserId, 'PROCESS_MILESTONE_SCHEDULED', 'ENROLLMENT', enrollmentId, {
      code: 'THEORY_PASSED',
      scheduledFor: scheduledFor.toISOString(),
      source: 'theory_exam_attempt',
      attemptId: id,
    });
    const attempt = await getTheoryExamAttempt(client, id);
    if (!attempt) throw new Error('Theory exam attempt disappeared during creation.');
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function rescheduleTheoryExamAttempt(
  pool: pg.Pool,
  input: { attemptId: string; scheduledFor: string | Date; protocol?: string | null; actorStaffUserId: string },
): Promise<TheoryExamAttempt> {
  const scheduledFor = asDate(input.scheduledFor, 'Data da prova');
  if (scheduledFor.getTime() <= Date.now()) throw new TheoryExamInputError('A nova data da prova precisa estar no futuro.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ enrollment_id: string; attendance_status: TheoryExamAttendance; resolved_at: Date | null }>(
      `SELECT enrollment_id, attendance_status, resolved_at FROM theory_exam_attempts WHERE id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    const row = current.rows[0];
    if (!row) throw new TheoryExamInputError('Tentativa de prova teórica não encontrada.');
    if (row.resolved_at || row.attendance_status !== 'PENDING') throw new TheoryExamConflictError('A tentativa não pode mais ser remarcada.');

    await client.query(
      `UPDATE theory_exam_attempts
       SET scheduled_for = $2, protocol = $3, updated_by_staff_user_id = $4, updated_at = now()
       WHERE id = $1`,
      [input.attemptId, scheduledFor, optional(input.protocol), input.actorStaffUserId],
    );
    await syncTheorySchedule(client, row.enrollment_id, scheduledFor, input.actorStaffUserId, 'Agendamento reconciliado com a tentativa operacional de prova teórica.');
    await insertAudit(client, input.actorStaffUserId, 'THEORY_EXAM_ATTEMPT_RESCHEDULED', 'TheoryExamAttempt', input.attemptId, {
      enrollmentId: row.enrollment_id,
      scheduledFor: scheduledFor.toISOString(),
    });
    const attempt = await getTheoryExamAttempt(client, input.attemptId);
    if (!attempt) throw new Error('Theory exam attempt disappeared during reschedule.');
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally { client.release(); }
}

export async function recordTheoryExamAttendance(
  pool: pg.Pool,
  input: { attemptId: string; attendanceStatus: string; actorStaffUserId: string },
): Promise<TheoryExamAttempt> {
  assertAttendance(input.attendanceStatus);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ enrollment_id: string; resolved_at: Date | null; official_result: TheoryExamResult }>(
      `SELECT enrollment_id, resolved_at, official_result FROM theory_exam_attempts WHERE id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    const row = current.rows[0];
    if (!row) throw new TheoryExamInputError('Tentativa de prova teórica não encontrada.');
    if (row.resolved_at || row.official_result !== 'PENDING') throw new TheoryExamConflictError('A tentativa já foi resolvida.');

    if (input.attendanceStatus === 'ABSENT') {
      await client.query(
        `UPDATE theory_exam_attempts
         SET attendance_status = 'ABSENT', resolved_at = now(), updated_by_staff_user_id = $2, updated_at = now()
         WHERE id = $1`,
        [input.attemptId, input.actorStaffUserId],
      );
      await syncTheorySchedule(client, row.enrollment_id, null, input.actorStaffUserId, 'Tentativa anterior encerrada por ausência; novo agendamento necessário.');
    } else {
      await client.query(
        `UPDATE theory_exam_attempts
         SET attendance_status = 'PRESENT', updated_by_staff_user_id = $2, updated_at = now()
         WHERE id = $1`,
        [input.attemptId, input.actorStaffUserId],
      );
    }
    await insertAudit(client, input.actorStaffUserId, 'THEORY_EXAM_ATTENDANCE_RECORDED', 'TheoryExamAttempt', input.attemptId, {
      enrollmentId: row.enrollment_id,
      attendanceStatus: input.attendanceStatus,
    });
    const attempt = await getTheoryExamAttempt(client, input.attemptId);
    if (!attempt) throw new Error('Theory exam attempt disappeared while recording attendance.');
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally { client.release(); }
}

export async function recordTheoryExamObservedResult(
  pool: pg.Pool,
  input: { attemptId: string; result: string; actorStaffUserId: string },
): Promise<TheoryExamAttempt> {
  assertFinalResult(input.result);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ attendance_status: TheoryExamAttendance; resolved_at: Date | null; official_result: TheoryExamResult }>(
      `SELECT attendance_status, resolved_at, official_result FROM theory_exam_attempts WHERE id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    const row = current.rows[0];
    if (!row) throw new TheoryExamInputError('Tentativa de prova teórica não encontrada.');
    if (row.attendance_status !== 'PRESENT') throw new TheoryExamConflictError('Registre presença antes do resultado observado.');
    if (row.resolved_at || row.official_result !== 'PENDING') throw new TheoryExamConflictError('A tentativa já foi resolvida.');

    await client.query(
      `UPDATE theory_exam_attempts
       SET observed_result = $2, updated_by_staff_user_id = $3, updated_at = now()
       WHERE id = $1`,
      [input.attemptId, input.result, input.actorStaffUserId],
    );
    await insertAudit(client, input.actorStaffUserId, 'THEORY_EXAM_RESULT_OBSERVED', 'TheoryExamAttempt', input.attemptId, { result: input.result });
    const attempt = await getTheoryExamAttempt(client, input.attemptId);
    if (!attempt) throw new Error('Theory exam attempt disappeared while recording observed result.');
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally { client.release(); }
}

export async function reconcileTheoryExamOfficialResult(
  pool: pg.Pool,
  input: { attemptId: string; result: string; actorStaffUserId: string },
): Promise<TheoryExamAttempt> {
  assertFinalResult(input.result);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      enrollment_id: string;
      scheduled_for: Date;
      attendance_status: TheoryExamAttendance;
      observed_result: TheoryExamResult;
      official_result: TheoryExamResult;
      resolved_at: Date | null;
    }>(
      `SELECT enrollment_id, scheduled_for, attendance_status, observed_result, official_result, resolved_at
       FROM theory_exam_attempts WHERE id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    const row = current.rows[0];
    if (!row) throw new TheoryExamInputError('Tentativa de prova teórica não encontrada.');
    if (row.attendance_status !== 'PRESENT') throw new TheoryExamConflictError('Resultado oficial exige presença registrada.');
    if (row.observed_result === 'PENDING') throw new TheoryExamConflictError('Registre primeiro o resultado observado pela escola.');
    if (row.official_result !== 'PENDING' || row.resolved_at) throw new TheoryExamConflictError('Resultado oficial já reconciliado.');

    if (input.result === 'APPROVED') {
      const process = await resolveEnrollmentProcess(client, row.enrollment_id);
      if (!process || !process.modeled || process.currentState.code !== 'THEORY_PASSED') {
        throw new TheoryExamConflictError(`A aprovação não pode avançar o processo fora da etapa THEORY_PASSED.`);
      }
    }

    await client.query(
      `UPDATE theory_exam_attempts
       SET official_result = $2, resolved_at = now(), updated_by_staff_user_id = $3, updated_at = now()
       WHERE id = $1`,
      [input.attemptId, input.result, input.actorStaffUserId],
    );

    if (input.result === 'APPROVED') {
      await client.query(
        `INSERT INTO enrollment_milestones(
           id, enrollment_id, code, scheduled_for, achieved_at,
           achieved_by_staff_user_id, updated_by_staff_user_id, note
         ) VALUES ($1, $2, 'THEORY_PASSED', $3, now(), $4, $4,
                   'Aprovação oficial reconciliada a partir da tentativa de prova teórica.')
         ON CONFLICT (enrollment_id, code) DO UPDATE SET
           scheduled_for = EXCLUDED.scheduled_for,
           achieved_at = now(),
           achieved_by_staff_user_id = EXCLUDED.achieved_by_staff_user_id,
           updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
           note = EXCLUDED.note,
           updated_at = now()`,
        [randomUUID(), row.enrollment_id, row.scheduled_for, input.actorStaffUserId],
      );
      await insertAudit(client, input.actorStaffUserId, 'PROCESS_MILESTONE_ACHIEVED', 'ENROLLMENT', row.enrollment_id, {
        code: 'THEORY_PASSED',
        source: 'theory_exam_official_result',
        attemptId: input.attemptId,
      });
    } else {
      await syncTheorySchedule(client, row.enrollment_id, null, input.actorStaffUserId, 'Tentativa reprovada; novo agendamento de prova teórica necessário.');
    }

    await insertAudit(client, input.actorStaffUserId, 'THEORY_EXAM_RESULT_RECONCILED', 'TheoryExamAttempt', input.attemptId, {
      enrollmentId: row.enrollment_id,
      observedResult: row.observed_result,
      officialResult: input.result,
      divergedFromObservation: row.observed_result !== input.result,
    });

    const attempt = await getTheoryExamAttempt(client, input.attemptId);
    if (!attempt) throw new Error('Theory exam attempt disappeared while reconciling official result.');
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally { client.release(); }
}
