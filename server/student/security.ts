import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashPassword, verifyPassword } from '../ops/credentials.js';

export class StudentSecurityInputError extends Error {}

export type StudentSecuritySnapshot = {
  passwordVersion: number;
  credentialUpdatedAt: Date;
  failedAttempts: number;
  lockedUntil: Date | null;
  disabledAt: Date | null;
  activeSessions: number;
};

export async function getStudentSecuritySnapshot(
  pool: pg.Pool,
  studentId: string,
): Promise<StudentSecuritySnapshot> {
  const result = await pool.query<{
    password_version: number;
    updated_at: Date;
    failed_attempts: number;
    locked_until: Date | null;
    disabled_at: Date | null;
    active_sessions: string;
  }>(
    `SELECT c.password_version, c.updated_at, c.failed_attempts, c.locked_until, c.disabled_at,
            count(se.id) FILTER (WHERE se.revoked_at IS NULL AND se.expires_at > now())::text AS active_sessions
     FROM student_credentials c
     LEFT JOIN sessions se ON se.student_id = c.student_id AND se.subject_type = 'STUDENT'
     WHERE c.student_id = $1
     GROUP BY c.student_id, c.password_version, c.updated_at, c.failed_attempts, c.locked_until, c.disabled_at`,
    [studentId],
  );
  const row = result.rows[0];
  if (!row) throw new StudentSecurityInputError('Credencial do aluno não encontrada.');
  return {
    passwordVersion: row.password_version,
    credentialUpdatedAt: row.updated_at,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    disabledAt: row.disabled_at,
    activeSessions: Number(row.active_sessions ?? 0),
  };
}

export async function changeOwnStudentPassword(
  pool: pg.Pool,
  input: {
    studentId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
  },
): Promise<{ revokedSessions: number; passwordVersion: number }> {
  if (!input.currentPassword) throw new StudentSecurityInputError('Informe sua senha atual.');
  if (input.newPassword.length < 12) throw new StudentSecurityInputError('A nova senha deve ter pelo menos 12 caracteres.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`student-security:${input.studentId}`]);
    const credentialResult = await client.query<{
      password_hash: string;
      password_version: number;
      disabled_at: Date | null;
    }>(
      `SELECT password_hash, password_version, disabled_at
       FROM student_credentials
       WHERE student_id = $1
       FOR UPDATE`,
      [input.studentId],
    );
    const credential = credentialResult.rows[0];
    if (!credential || credential.disabled_at) throw new StudentSecurityInputError('Credencial indisponível.');
    if (!await verifyPassword(credential.password_hash, input.currentPassword)) {
      throw new StudentSecurityInputError('Senha atual inválida.');
    }
    if (await verifyPassword(credential.password_hash, input.newPassword)) {
      throw new StudentSecurityInputError('A nova senha precisa ser diferente da senha atual.');
    }

    const passwordHash = await hashPassword(input.newPassword);
    const updated = await client.query<{ password_version: number }>(
      `UPDATE student_credentials
       SET password_hash = $2,
           must_change_password = false,
           password_version = password_version + 1,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()
       WHERE student_id = $1
       RETURNING password_version`,
      [input.studentId, passwordHash],
    );

    const revoked = await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE student_id = $1
         AND subject_type = 'STUDENT'
         AND id <> $2
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [input.studentId, input.currentSessionId],
    );

    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_PASSWORD_CHANGED', 'StudentCredential', $2, $3::jsonb)`,
      [randomUUID(), input.studentId, JSON.stringify({
        sessionId: input.currentSessionId,
        revokedSessions: revoked.rowCount ?? 0,
      })],
    );
    await client.query('COMMIT');
    return {
      revokedSessions: revoked.rowCount ?? 0,
      passwordVersion: updated.rows[0].password_version,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeOtherStudentSessions(
  pool: pg.Pool,
  input: { studentId: string; currentSessionId: string },
): Promise<{ revokedSessions: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const revoked = await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE student_id = $1
         AND subject_type = 'STUDENT'
         AND id <> $2
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [input.studentId, input.currentSessionId],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_OTHER_SESSIONS_REVOKED', 'Session', $3, $4::jsonb)`,
      [randomUUID(), input.studentId, input.currentSessionId, JSON.stringify({ revokedSessions: revoked.rowCount ?? 0 })],
    );
    await client.query('COMMIT');
    return { revokedSessions: revoked.rowCount ?? 0 };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}
