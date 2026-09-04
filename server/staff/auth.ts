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

function logCredentialDiagnostic(usernameInput: string, password: string): void {
  const expectedUsername = process.env.CENTRO_ADMIN_RECOVERY_USERNAME ?? '';
  const expectedPassword = process.env.CENTRO_ADMIN_RECOVERY_PASSWORD ?? '';
  if (!expectedUsername && !expectedPassword) return;

  console.info('[centro-admin-login-diagnostic]', JSON.stringify({
    usernameMatches: usernameInput.trim().toLowerCase() === expectedUsername.trim().toLowerCase(),
    passwordMatches: password === expectedPassword,
    usernameLength: usernameInput.length,
    passwordLength: password.length,
  }));
}

export type StaffSession = {
  sessionId: string;
  staffUserId: string;
  username: string;
  displayName: string;
  role: 'STAFF' | 'ADMIN';
  expiresAt: Date;
};

export async function bootstrapFirstAdmin(
  pool: pg.Pool,
  input: { username: string; displayName: string; password: string },
): Promise<{ created: boolean; staffUserId: string | null }> {
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!username || !displayName) throw new Error('username and displayName are required.');
  if (input.password.length < 12) throw new Error('bootstrap password must contain at least 12 characters.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('centro-first-admin-bootstrap'))`);
    const existing = await client.query<{ id: string }>('SELECT id FROM staff_users ORDER BY created_at LIMIT 1');
    if (existing.rowCount) {
      await client.query('COMMIT');
      return { created: false, staffUserId: existing.rows[0].id };
    }

    const staffUserId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await client.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, $3, 'ADMIN')`,
      [staffUserId, username, displayName],
    );
    await client.query(
      `INSERT INTO staff_credentials(staff_user_id, password_hash)
       VALUES ($1, $2)`,
      [staffUserId, passwordHash],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, action, entity_type, entity_id, metadata)
       VALUES ($1, 'SYSTEM', 'STAFF_BOOTSTRAPPED', 'StaffUser', $2, $3::jsonb)`,
      [randomUUID(), staffUserId, JSON.stringify({ username })],
    );
    await client.query('COMMIT');
    return { created: true, staffUserId };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

async function recordFailedAttempt(pool: pg.Pool, staffUserId: string, previousAttempts: number): Promise<void> {
  const nextAttempts = previousAttempts + 1;
  const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
  await pool.query(
    `UPDATE staff_credentials
     SET failed_attempts = $2,
         locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END,
         updated_at = now()
     WHERE staff_user_id = $1`,
    [staffUserId, shouldLock ? 0 : nextAttempts, shouldLock, LOCK_MINUTES],
  );
}

export async function authenticateStaff(
  pool: pg.Pool,
  usernameInput: string,
  password: string,
): Promise<{ token: string; session: StaffSession } | null> {
  logCredentialDiagnostic(usernameInput, password);
  const username = usernameInput.trim();
  if (!username || !password) return null;

  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    role: 'STAFF' | 'ADMIN';
    active: boolean;
    password_hash: string;
    failed_attempts: number;
    locked_until: Date | null;
    disabled_at: Date | null;
  }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.active,
            c.password_hash, c.failed_attempts, c.locked_until, c.disabled_at
     FROM staff_users u
     JOIN staff_credentials c ON c.staff_user_id = u.id
     WHERE lower(u.username) = lower($1)
     LIMIT 1`,
    [username],
  );

  const row = result.rows[0];
  if (!row || !row.active || row.disabled_at) return null;
  if (row.locked_until && row.locked_until.getTime() > Date.now()) return null;

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
      `UPDATE staff_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE staff_user_id = $1`,
      [row.id],
    );
    await client.query(
      `INSERT INTO sessions(id, token_hash, subject_type, staff_user_id, expires_at)
       VALUES ($1, $2, 'STAFF', $3, $4)`,
      [sessionId, tokenHash, row.id, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id)
       VALUES ($1, 'STAFF', $2, 'STAFF_LOGIN', 'Session', $3)`,
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
      staffUserId: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      expiresAt,
    },
  };
}

export async function resolveStaffSession(pool: pg.Pool, token: string): Promise<StaffSession | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{
    session_id: string;
    staff_user_id: string;
    username: string;
    display_name: string;
    role: 'STAFF' | 'ADMIN';
    expires_at: Date;
  }>(
    `SELECT s.id AS session_id, u.id AS staff_user_id, u.username, u.display_name, u.role, s.expires_at
     FROM sessions s
     JOIN staff_users u ON u.id = s.staff_user_id
     JOIN staff_credentials c ON c.staff_user_id = u.id
     WHERE s.token_hash = $1
       AND s.subject_type = 'STAFF'
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.active = true
       AND c.disabled_at IS NULL
     LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;

  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  return {
    sessionId: row.session_id,
    staffUserId: row.staff_user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    expiresAt: row.expires_at,
  };
}

export async function revokeStaffSession(pool: pg.Pool, token: string, actorStaffUserId: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{ id: string }>(
    `UPDATE sessions
     SET revoked_at = now()
     WHERE token_hash = $1 AND subject_type = 'STAFF' AND revoked_at IS NULL
     RETURNING id`,
    [tokenHash],
  );
  const sessionId = result.rows[0]?.id;
  if (!sessionId) return;

  await pool.query(
    `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id)
     VALUES ($1, 'STAFF', $2, 'STAFF_LOGOUT', 'Session', $3)`,
    [randomUUID(), actorStaffUserId, sessionId],
  );
}
