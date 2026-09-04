import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { hashPassword } from '../ops/credentials.js';
import { authenticateStaff, resolveStaffSession, rotateStaffPassword } from './auth.js';

test('admin password rotation replaces persisted credential and revokes Staff sessions', async () => {
  const pool = createDatabasePool();
  const staffUserId = randomUUID();
  const username = `rotate-${randomUUID()}`;
  const oldPassword = `old-${randomUUID()}-credential`;
  const newPassword = `new-${randomUUID()}-credential`;

  try {
    const oldHash = await hashPassword(oldPassword);
    await pool.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, 'Rotation Witness', 'ADMIN')`,
      [staffUserId, username],
    );
    await pool.query(
      `INSERT INTO staff_credentials(staff_user_id, password_hash)
       VALUES ($1, $2)`,
      [staffUserId, oldHash],
    );

    const before = await authenticateStaff(pool, username, oldPassword);
    assert.ok(before, 'old credential should authenticate before rotation');
    assert.ok(await resolveStaffSession(pool, before.token), 'pre-rotation Staff session should resolve');

    const rotation = await rotateStaffPassword(pool, { username, password: newPassword });
    assert.equal(rotation.rotated, true);
    assert.equal(rotation.staffUserId, staffUserId);

    assert.equal(await resolveStaffSession(pool, before.token), null, 'rotation must revoke existing Staff sessions');
    assert.equal(await authenticateStaff(pool, username, oldPassword), null, 'old password must stop authenticating');

    const after = await authenticateStaff(pool, username, newPassword);
    assert.ok(after, 'new password must authenticate');

    const credential = await pool.query<{
      password_version: number;
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT password_version, failed_attempts, locked_until
       FROM staff_credentials
       WHERE staff_user_id = $1`,
      [staffUserId],
    );
    assert.equal(credential.rows[0]?.password_version, 2);
    assert.equal(credential.rows[0]?.failed_attempts, 0);
    assert.equal(credential.rows[0]?.locked_until, null);

    const audit = await pool.query<{ actor_type: string; action: string }>(
      `SELECT actor_type, action
       FROM audit_events
       WHERE entity_id = $1 AND action = 'STAFF_CREDENTIAL_ROTATED'`,
      [staffUserId],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0]?.actor_type, 'SYSTEM');
  } finally {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffUserId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffUserId]);
    await pool.query('DELETE FROM staff_credentials WHERE staff_user_id = $1', [staffUserId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffUserId]);
    await pool.end();
  }
});
