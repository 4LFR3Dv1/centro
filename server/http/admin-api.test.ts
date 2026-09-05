import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { createAdminApiHandler } from './admin-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'admin-api-test';
const ADMIN_PASSWORD = 'Strong-Test-Password-2026!';
const TEST_DOCUMENT = '11222333000';

function cookieValue(setCookie: string | null): string {
  assert.ok(setCookie, 'login must return Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [TEST_DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);

  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
  }
  for (const studentId of studentIds) {
    await pool.query(
      `DELETE FROM audit_events
       WHERE entity_id = $1
          OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)
          OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)`,
      [studentId],
    );
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }
  if (staffId) await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
}

test('ACCESS-002 admin enrollment API derives Staff authority and never issues a student password', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Admin API Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const handler = createAdminApiHandler(pool, { publicOrigin: ORIGIN, secureCookies: false });
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
    const wrongOrigin = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    assert.equal(wrongOrigin.status, 403);

    const wrongPassword = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: ADMIN_USER, password: 'wrong-password' }),
    });
    assert.equal(wrongPassword.status, 401);

    const unauthenticatedEnrollment = await fetch(`${base}/api/admin/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({
        fullName: 'Unauthorized Student',
        phone: '12999999999',
        document: TEST_DOCUMENT,
        serviceType: 'FIRST_LICENSE',
        category: 'B',
      }),
    });
    assert.equal(unauthenticatedEnrollment.status, 401);

    const login = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieValue(login.headers.get('set-cookie'));
    const loginBody = await login.json() as { staff?: { role?: string }; token?: string };
    assert.equal(loginBody.staff?.role, 'ADMIN');
    assert.equal('token' in loginBody, false);

    const session = await fetch(`${base}/api/admin/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);

    const first = await fetch(`${base}/api/admin/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({
        fullName: 'Maria Admin API',
        phone: '12981779745',
        email: 'maria@example.test',
        document: TEST_DOCUMENT,
        serviceType: 'FIRST_LICENSE',
        category: 'B',
      }),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json() as {
      student: { id: string; publicId: string };
      credential: { created: boolean; initialPassword: string | null; mustChangePassword: boolean };
      passwordHash?: string;
    };
    assert.match(firstBody.student.publicId, /^CEN-\d{2}-\d{5,}$/);
    assert.equal(firstBody.credential.created, false);
    assert.equal(firstBody.credential.initialPassword, null);
    assert.equal(firstBody.credential.mustChangePassword, false);
    assert.equal('passwordHash' in firstBody, false);

    const credentialCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM student_credentials WHERE student_id = $1',
      [firstBody.student.id],
    );
    assert.equal(credentialCount.rows[0]?.count, '0');

    const qrCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM student_access_qrs WHERE student_id = $1 AND revoked_at IS NULL',
      [firstBody.student.id],
    );
    assert.equal(qrCount.rows[0]?.count, '1');

    const second = await fetch(`${base}/api/admin/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({
        fullName: 'Maria Admin API',
        phone: '12981779745',
        document: TEST_DOCUMENT,
        serviceType: 'CATEGORY_ADDITION',
        category: 'A',
      }),
    });
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { student: { publicId: string }; credential: { created: boolean; initialPassword: string | null } };
    assert.equal(secondBody.student.publicId, firstBody.student.publicId);
    assert.equal(secondBody.credential.created, false);
    assert.equal(secondBody.credential.initialPassword, null);

    const enrollmentAudit = await pool.query<{ actor_staff_user_id: string }>(
      `SELECT actor_staff_user_id
       FROM audit_events
       WHERE action = 'ENROLLMENT_CREATED'
         AND entity_id IN (
           SELECT e.id
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           WHERE s.document_normalized = $1
         )`,
      [TEST_DOCUMENT],
    );
    assert.equal(enrollmentAudit.rowCount, 2);
    assert.ok(enrollmentAudit.rows.every((row) => row.actor_staff_user_id === bootstrap.staffUserId));

    const logout = await fetch(`${base}/api/admin/auth/logout`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: cookie },
    });
    assert.equal(logout.status, 204);

    const afterLogout = await fetch(`${base}/api/admin/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({
        fullName: 'Blocked Student',
        phone: '12911111111',
        document: '22111333000',
        serviceType: 'FIRST_LICENSE',
        category: 'B',
      }),
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
