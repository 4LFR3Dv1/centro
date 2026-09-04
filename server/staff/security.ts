import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashPassword, verifyPassword } from '../ops/credentials.js';

export class StaffSecurityInputError extends Error {}

export type StaffSecuritySnapshot = {
  staffUserId: string;
  passwordVersion: number;
  credentialUpdatedAt: Date;
  failedAttempts: number;
  lockedUntil: Date | null;
  disabledAt: Date | null;
  activeSessions: number;
};

function validateNewPassword(password: string): void {
  if (password.length < 12) throw new StaffSecurityInputError('A nova senha deve ter pelo menos 12 caracteres.');
}

export async function getStaffSecuritySnapshot(pool: pg.Pool, staffUserId: string): Promise<StaffSecuritySnapshot | null> {
  const result = await pool.query<{
    password_version: number;
    updated_at: Date;
    failed_attempts: number;
    locked_until: Date | null;
    disabled_at: Date | null;
    active_sessions: number;
  }>(
    `SELECT c.password_version,
            c.updated_at,
            c.failed_attempts,
            c.locked_until,
            c.disabled_at,
            count(s.id)::int AS active_sessions
     FROM staff_credentials c
     LEFT JOIN sessions s
       ON s.staff_user_id = c.staff_user_id
      AND s.subject_type = 'STAFF'
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
     WHERE c.staff_user_id = $1
     GROUP BY c.staff_user_id, c.password_version, c.updated_at, c.failed_attempts, c.locked_until, c.disabled_at`,
    [staffUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    staffUserId,
    passwordVersion: row.password_version,
    credentialUpdatedAt: row.updated_at,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    disabledAt: row.disabled_at,
    activeSessions: row.active_sessions,
  };
}

export async function changeOwnStaffPassword(
  pool: pg.Pool,
  input: {
    staffUserId: string;
    currentSessionId: string;
    currentPassword: string;
    newPassword: string;
  },
): Promise<{ passwordVersion: number; revokedOtherSessions: number }> {
  if (!input.currentPassword) throw new StaffSecurityInputError('Informe a senha atual.');
  validateNewPassword(input.newPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`centro-staff-password:${input.staffUserId}`]);
    const credential = await client.query<{
      password_hash: string;
      password_version: number;
      disabled_at: Date | null;
    }>(
      `SELECT password_hash, password_version, disabled_at
       FROM staff_credentials
       WHERE staff_user_id = $1
       FOR UPDATE`,
      [input.staffUserId],
    );
    const row = credential.rows[0];
    if (!row || row.disabled_at) throw new StaffSecurityInputError('A credencial não está disponível.');

    const currentValid = await verifyPassword(row.password_hash, input.currentPassword);
    if (!currentValid) throw new StaffSecurityInputError('Senha atual inválida.');
    if (await verifyPassword(row.password_hash, input.newPassword)) {
      throw new StaffSecurityInputError('A nova senha deve ser diferente da senha atual.');
    }

    const passwordHash = await hashPassword(input.newPassword);
    const updated = await client.query<{ password_version: number }>(
      `UPDATE staff_credentials
       SET password_hash = $2,
           password_version = password_version + 1,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()
       WHERE staff_user_id = $1
       RETURNING password_version`,
      [input.staffUserId, passwordHash],
    );

    const revoked = await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE subject_type = 'STAFF'
         AND staff_user_id = $1
         AND id <> $2
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [input.staffUserId, input.currentSessionId],
    );
    const revokedOtherSessions = revoked.rowCount ?? 0;
    const passwordVersion = updated.rows[0].password_version;

    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STAFF', $2, 'STAFF_PASSWORD_CHANGED', 'StaffCredential', $2, $3::jsonb)`,
      [randomUUID(), input.staffUserId, JSON.stringify({ passwordVersion, revokedOtherSessions })],
    );
    await client.query('COMMIT');
    return { passwordVersion, revokedOtherSessions };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function recoverStaffPassword(
  pool: pg.Pool,
  input: { username: string; newPassword: string },
): Promise<{ recovered: boolean; staffUserId: string | null; passwordVersion: number | null; revokedSessions: number }> {
  const username = input.username.trim();
  if (!username) throw new StaffSecurityInputError('username is required.');
  validateNewPassword(input.newPassword);
  const passwordHash = await hashPassword(input.newPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`centro-staff-recovery:${username.toLowerCase()}`]);
    const existing = await client.query<{ id: string }>(
      `SELECT u.id
       FROM staff_users u
       JOIN staff_credentials c ON c.staff_user_id = u.id
       WHERE lower(u.username) = lower($1)
       LIMIT 1
       FOR UPDATE OF u, c`,
      [username],
    );
    const staffUserId = existing.rows[0]?.id ?? null;
    if (!staffUserId) {
      await client.query('ROLLBACK');
      return { recovered: false, staffUserId: null, passwordVersion: null, revokedSessions: 0 };
    }

    const updated = await client.query<{ password_version: number }>(
      `UPDATE staff_credentials
       SET password_hash = $2,
           password_version = password_version + 1,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()
       WHERE staff_user_id = $1
       RETURNING password_version`,
      [staffUserId, passwordHash],
    );
    const revoked = await client.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE subject_type = 'STAFF'
         AND staff_user_id = $1
         AND revoked_at IS NULL`,
      [staffUserId],
    );
    const revokedSessions = revoked.rowCount ?? 0;
    const passwordVersion = updated.rows[0].password_version;

    await client.query(
      `INSERT INTO audit_events(id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, 'SYSTEM', 'STAFF_CREDENTIAL_RECOVERED', 'StaffCredential', $2, $3::jsonb)`,
      [randomUUID(), staffUserId, JSON.stringify({ username, passwordVersion, revokedSessions, source: 'operator_recovery' })],
    );
    await client.query('COMMIT');
    return { recovered: true, staffUserId, passwordVersion, revokedSessions };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}
