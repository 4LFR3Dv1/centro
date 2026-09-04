import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { hashPassword } from '../ops/credentials.js';
import { authenticateStaff, resolveStaffSession } from '../staff/auth.js';
import { recoverStaffPassword } from '../staff/security.js';
import { createStaffSecurityApiHandler } from './staff-security-api.js';

const ORIGIN = 'https://centro-security.test';

function cookie(token: string): string {
  return `centro_admin_session=${encodeURIComponent(token)}`;
}

async function post(base: string, token: string, body: unknown, origin = ORIGIN) {
  return fetch(`${base}/api/admin/security/password`, {
    method: 'POST',
    headers: {
      Cookie: cookie(token),
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('STAFF-SECURITY changes own password while preserving current session and supports explicit recovery', async () => {
  const pool = createDatabasePool();
  const staffUserId = randomUUID();
  const username = `security-${randomUUID()}`;
  const oldPassword = `Old-${randomUUID()}-Credential`;
  const newPassword = `New-${randomUUID()}-Credential`;
  const recoveryPassword = `Recovery-${randomUUID()}-Credential`;

  try {
    await pool.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, 'Security Witness', 'ADMIN')`,
      [staffUserId, username],
    );
    await pool.query(
      `INSERT INTO staff_credentials(staff_user_id, password_hash)
       VALUES ($1, $2)`,
      [staffUserId, await hashPassword(oldPassword)],
    );

    const sessionA = await authenticateStaff(pool, username, oldPassword);
    const sessionB = await authenticateStaff(pool, username, oldPassword);
    assert.ok(sessionA);
    assert.ok(sessionB);

    const handler = createStaffSecurityApiHandler(pool, { publicOrigin: ORIGIN });
    const server = createServer((req, res) => {
      void handler(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const anonymous = await fetch(`${base}/api/admin/security`);
      assert.equal(anonymous.status, 401);

      const before = await fetch(`${base}/api/admin/security`, { headers: { Cookie: cookie(sessionA.token) } });
      assert.equal(before.status, 200);
      const beforeBody = await before.json() as { passwordVersion: number; activeSessions: number };
      assert.equal(beforeBody.passwordVersion, 1);
      assert.equal(beforeBody.activeSessions, 2);

      const wrongOrigin = await post(base, sessionA.token, {
        currentPassword: oldPassword,
        newPassword,
      }, 'https://invalid-origin.test');
      assert.equal(wrongOrigin.status, 403);

      const wrongCurrent = await post(base, sessionA.token, {
        currentPassword: `Wrong-${randomUUID()}`,
        newPassword,
      });
      assert.equal(wrongCurrent.status, 400);

      const samePassword = await post(base, sessionA.token, {
        currentPassword: oldPassword,
        newPassword: oldPassword,
      });
      assert.equal(samePassword.status, 400);

      const changed = await post(base, sessionA.token, {
        currentPassword: oldPassword,
        newPassword,
      });
      assert.equal(changed.status, 200);
      const changedBody = await changed.json() as { passwordVersion: number; revokedOtherSessions: number };
      assert.equal(changedBody.passwordVersion, 2);
      assert.equal(changedBody.revokedOtherSessions, 1);

      assert.ok(await resolveStaffSession(pool, sessionA.token), 'the session performing the password change must survive');
      assert.equal(await resolveStaffSession(pool, sessionB.token), null, 'other Staff sessions must be revoked');
      assert.equal(await authenticateStaff(pool, username, oldPassword), null, 'old password must stop authenticating');

      const sessionC = await authenticateStaff(pool, username, newPassword);
      assert.ok(sessionC, 'new password must authenticate');

      const recovered = await recoverStaffPassword(pool, { username, newPassword: recoveryPassword });
      assert.equal(recovered.recovered, true);
      assert.equal(recovered.staffUserId, staffUserId);
      assert.equal(recovered.passwordVersion, 3);
      assert.ok(recovered.revokedSessions >= 2);

      assert.equal(await resolveStaffSession(pool, sessionA.token), null, 'operator recovery revokes the previously preserved session');
      assert.equal(await resolveStaffSession(pool, sessionC.token), null, 'operator recovery revokes every active Staff session');
      assert.equal(await authenticateStaff(pool, username, newPassword), null, 'pre-recovery password must stop authenticating');
      assert.ok(await authenticateStaff(pool, username, recoveryPassword), 'recovery password must authenticate');

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
      assert.equal(credential.rows[0]?.password_version, 3);
      assert.equal(credential.rows[0]?.failed_attempts, 0);
      assert.equal(credential.rows[0]?.locked_until, null);

      const audit = await pool.query<{ action: string; actor_type: string }>(
        `SELECT action, actor_type
         FROM audit_events
         WHERE entity_id = $1
           AND action IN ('STAFF_PASSWORD_CHANGED', 'STAFF_CREDENTIAL_RECOVERED')
         ORDER BY occurred_at`,
        [staffUserId],
      );
      assert.equal(audit.rows.length, 2);
      assert.equal(audit.rows[0]?.action, 'STAFF_PASSWORD_CHANGED');
      assert.equal(audit.rows[0]?.actor_type, 'STAFF');
      assert.equal(audit.rows[1]?.action, 'STAFF_CREDENTIAL_RECOVERED');
      assert.equal(audit.rows[1]?.actor_type, 'SYSTEM');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffUserId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffUserId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffUserId]);
    await pool.end();
  }
});
