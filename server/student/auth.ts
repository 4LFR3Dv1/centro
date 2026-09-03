import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from '../ops/credentials.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 12;

export type StudentEnrollmentSummary = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'ACTIVE';
  openedAt: Date;
};

export type StudentSession = {
  sessionId: string;
  studentId: string;
  publicId: string;
  fullName: string;
  mustChangePassword: boolean;
  expiresAt: Date;
  enrollments: StudentEnrollmentSummary[];
};

async function activeEnrollments(pool: pg.Pool, studentId: string): Promise<StudentEnrollmentSummary[]> {
  const result = await pool.query<{
    id: string;
    service_type: StudentEnrollmentSummary['serviceType'];
    category: StudentEnrollmentSummary['category'];
    status: 'ACTIVE';
    opened_at: Date;
  }>(
    `SELECT id, service_type, category, status, opened_at
     FROM enrollments
     WHERE student_id = $1
       AND status = 'ACTIVE'
     ORDER BY opened_at DESC, created_at DESC`,
    [studentId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    serviceType: row.service_type,
    category: row.category,
    status: row.status,
    openedAt: row.opened_at,
  }));
}

async function recordFailedAttempt(pool: pg.Pool, studentId: string, previousAttempts: number): Promise<void> {
  const nextAttempts = previousAttempts + 1;
  const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
  await pool.query(
    `UPDATE student_credentials
     SET failed_attempts = $2,
         locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END,
         updated_at = now()
     WHERE student_id = $1`,
    [studentId, shouldLock ? 0 : nextAttempts, shouldLock, LOCK_MINUTES],
  );
}

export async function authenticateStudent(
  pool: pg.Pool,
  publicIdInput: string,
  password: string,
): Promise<{ token: string; session: StudentSession } | null> {
  const publicId = publicIdInput.trim().toUpperCase();
  if (!publicId || !password) return null;

  const result = await pool.query<{
    id: string;
    public_id: string;
    full_name: string;
    status: 'ACTIVE' | 'ARCHIVED';
    password_hash: string;
    must_change_password: boolean;
    failed_attempts: number;
    locked_until: Date | null;
    disabled_at: Date | null;
  }>(
    `SELECT s.id, s.public_id, s.full_name, s.status,
            c.password_hash, c.must_change_password, c.failed_attempts, c.locked_until, c.disabled_at
     FROM students s
     JOIN student_credentials c ON c.student_id = s.id
     WHERE upper(s.public_id) = $1
     LIMIT 1`,
    [publicId],
  );

  const row = result.rows[0];
  if (!row || row.status !== 'ACTIVE' || row.disabled_at) return null;
  if (row.locked_until && row.locked_until.getTime() > Date.now()) return null;

  const enrollments = await activeEnrollments(pool, row.id);
  if (enrollments.length === 0) return null;

  const valid = await verifyPassword(row.password_hash, password);
  if (!valid) {
    await recordFailedAttempt(pool, row.id, row.failed_attempts);
    return null;
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE student_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE student_id = $1`,
      [row.id],
    );
    await client.query(
      `INSERT INTO sessions(id, token_hash, subject_type, student_id, expires_at)
       VALUES ($1, $2, 'STUDENT', $3, $4)`,
      [sessionId, tokenHash, row.id, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_LOGIN', 'Session', $3)`,
      [randomUUID(), row.id, sessionId],
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }

  return {
    token,
    session: {
      sessionId,
      studentId: row.id,
      publicId: row.public_id,
      fullName: row.full_name,
      mustChangePassword: row.must_change_password,
      expiresAt,
      enrollments,
    },
  };
}

export async function resolveStudentSession(pool: pg.Pool, token: string): Promise<StudentSession | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{
    session_id: string;
    student_id: string;
    public_id: string;
    full_name: string;
    must_change_password: boolean;
    expires_at: Date;
  }>(
    `SELECT se.id AS session_id, s.id AS student_id, s.public_id, s.full_name,
            c.must_change_password, se.expires_at
     FROM sessions se
     JOIN students s ON s.id = se.student_id
     JOIN student_credentials c ON c.student_id = s.id
     WHERE se.token_hash = $1
       AND se.subject_type = 'STUDENT'
       AND se.revoked_at IS NULL
       AND se.expires_at > now()
       AND s.status = 'ACTIVE'
       AND c.disabled_at IS NULL
     LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;

  const enrollments = await activeEnrollments(pool, row.student_id);
  if (enrollments.length === 0) return null;

  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  return {
    sessionId: row.session_id,
    studentId: row.student_id,
    publicId: row.public_id,
    fullName: row.full_name,
    mustChangePassword: row.must_change_password,
    expiresAt: row.expires_at,
    enrollments,
  };
}

export async function changeInitialStudentPassword(
  pool: pg.Pool,
  session: StudentSession,
  newPassword: string,
): Promise<void> {
  if (!session.mustChangePassword) throw new Error('Initial password has already been changed.');
  if (newPassword.length < 12) throw new Error('New password must contain at least 12 characters.');

  const current = await pool.query<{ password_hash: string; must_change_password: boolean }>(
    `SELECT password_hash, must_change_password
     FROM student_credentials
     WHERE student_id = $1
     LIMIT 1`,
    [session.studentId],
  );
  const credential = current.rows[0];
  if (!credential || !credential.must_change_password) throw new Error('Initial password has already been changed.');
  if (await verifyPassword(credential.password_hash, newPassword)) {
    throw new Error('New password must be different from the initial password.');
  }

  const passwordHash = await hashPassword(newPassword);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE student_credentials
       SET password_hash = $2,
           must_change_password = false,
           password_version = password_version + 1,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()
       WHERE student_id = $1
         AND must_change_password = true`,
      [session.studentId, passwordHash],
    );
    if (updated.rowCount !== 1) throw new Error('Initial password has already been changed.');

    await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE student_id = $1
         AND subject_type = 'STUDENT'
         AND id <> $2
         AND revoked_at IS NULL`,
      [session.studentId, session.sessionId],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_INITIAL_PASSWORD_CHANGED', 'StudentCredential', $2, $3::jsonb)`,
      [randomUUID(), session.studentId, JSON.stringify({ sessionId: session.sessionId })],
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeStudentSession(pool: pg.Pool, token: string, actorStudentId: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{ id: string }>(
    `UPDATE sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND subject_type = 'STUDENT' AND revoked_at IS NULL
     RETURNING id`,
    [tokenHash],
  );
  const sessionId = result.rows[0]?.id;
  if (!sessionId) return;

  await pool.query(
    `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id)
     VALUES ($1, 'STUDENT', $2, 'STUDENT_LOGOUT', 'Session', $3)`,
    [randomUUID(), actorStudentId, sessionId],
  );
}
