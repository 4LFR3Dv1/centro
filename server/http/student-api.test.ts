import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { hashPassword } from '../ops/credentials.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { createStudentApiHandler } from './student-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'student-api-admin-test';
const ADMIN_PASSWORD = 'Strong-Student-Test-Admin-2026!';
const TEST_DOCUMENT = '99888777666';
const LEGACY_INITIAL_PASSWORD = `Legacy-${randomUUID()}!9`;
const NEW_PASSWORD = 'Senha-Nova-Do-Aluno-2026!';

function cookieValue(setCookie: string | null): string {
  assert.ok(setCookie, 'login must return Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [TEST_DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);

  for (const studentId of studentIds) {
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1', [studentId]);
    await pool.query(
      `DELETE FROM audit_events
       WHERE entity_id = $1
          OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)
          OR entity_id IN (SELECT id FROM sessions WHERE student_id = $1)
          OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)`,
      [studentId],
    );
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

test('STUDENT-001 legacy initial-password credentials still rotate after ACCESS-002 cutover', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Student API Admin Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const enrollment = await materializeEnrollment(pool, {
    fullName: 'Aluno Portal Teste',
    phone: '12999990000',
    email: 'aluno.portal@example.test',
    document: TEST_DOCUMENT,
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.equal(enrollment.credentialCreated, false);
  assert.equal(enrollment.initialPassword, null);

  // Explicitly materialize a pre-ACCESS-002 credential to prove the legacy migration path remains valid.
  const legacyHash = await hashPassword(LEGACY_INITIAL_PASSWORD);
  await pool.query(
    `INSERT INTO student_credentials(student_id, password_hash, must_change_password)
     VALUES ($1, $2, true)`,
    [enrollment.studentId, legacyHash],
  );

  const handler = createStudentApiHandler(pool, { publicOrigin: ORIGIN, secureCookies: false });
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
    const wrongOrigin = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ publicId: enrollment.studentPublicId, password: LEGACY_INITIAL_PASSWORD }),
    });
    assert.equal(wrongOrigin.status, 403);

    const wrongPassword = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ publicId: enrollment.studentPublicId, password: 'senha-invalida' }),
    });
    assert.equal(wrongPassword.status, 401);

    const login = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ publicId: enrollment.studentPublicId, password: LEGACY_INITIAL_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const firstCookie = cookieValue(login.headers.get('set-cookie'));
    const loginBody = await login.json() as {
      student: { id: string; publicId: string; fullName: string; document?: string };
      credential: { mustChangePassword: boolean };
      enrollments: Array<{ id: string; status: string }>;
      nextAction: { code: string; href: string } | null;
      token?: string;
    };
    assert.equal(loginBody.student.id, enrollment.studentId);
    assert.equal(loginBody.student.publicId, enrollment.studentPublicId);
    assert.equal(loginBody.student.fullName, 'Aluno Portal Teste');
    assert.equal('document' in loginBody.student, false);
    assert.equal('token' in loginBody, false);
    assert.equal(loginBody.credential.mustChangePassword, true);
    assert.equal(loginBody.enrollments.length, 1);
    assert.equal(loginBody.enrollments[0].status, 'ACTIVE');
    assert.deepEqual(loginBody.nextAction, { code: 'CHANGE_INITIAL_PASSWORD', href: '/aluno/trocar-senha' });

    const session = await fetch(`${base}/api/student/auth/session`, { headers: { Cookie: firstCookie } });
    assert.equal(session.status, 200);

    const shortPassword = await fetch(`${base}/api/student/auth/change-initial-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: firstCookie },
      body: JSON.stringify({ newPassword: 'curta' }),
    });
    assert.equal(shortPassword.status, 400);

    const change = await fetch(`${base}/api/student/auth/change-initial-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: firstCookie },
      body: JSON.stringify({ newPassword: NEW_PASSWORD }),
    });
    assert.equal(change.status, 200);
    const changeBody = await change.json() as { credential: { mustChangePassword: boolean }; nextAction: unknown };
    assert.equal(changeBody.credential.mustChangePassword, false);
    assert.equal(changeBody.nextAction, null);

    const credential = await pool.query<{ must_change_password: boolean; password_version: number }>(
      'SELECT must_change_password, password_version FROM student_credentials WHERE student_id = $1',
      [enrollment.studentId],
    );
    assert.equal(credential.rows[0].must_change_password, false);
    assert.equal(credential.rows[0].password_version, 2);

    const initialNoLongerWorks = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ publicId: enrollment.studentPublicId, password: LEGACY_INITIAL_PASSWORD }),
    });
    assert.equal(initialNoLongerWorks.status, 401);

    const secondLogin = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ publicId: enrollment.studentPublicId, password: NEW_PASSWORD }),
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = cookieValue(secondLogin.headers.get('set-cookie'));
    const secondBody = await secondLogin.json() as { credential: { mustChangePassword: boolean }; nextAction: unknown };
    assert.equal(secondBody.credential.mustChangePassword, false);
    assert.equal(secondBody.nextAction, null);

    const logout = await fetch(`${base}/api/student/auth/logout`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: secondCookie },
    });
    assert.equal(logout.status, 204);

    const afterLogout = await fetch(`${base}/api/student/auth/session`, { headers: { Cookie: secondCookie } });
    assert.equal(afterLogout.status, 401);

    const audit = await pool.query<{ action: string; actor_student_id: string }>(
      `SELECT action, actor_student_id
       FROM audit_events
       WHERE actor_student_id = $1
         AND action IN ('STUDENT_LOGIN', 'STUDENT_INITIAL_PASSWORD_CHANGED', 'STUDENT_LOGOUT')`,
      [enrollment.studentId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_INITIAL_PASSWORD_CHANGED'));
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_LOGOUT'));
    assert.ok(audit.rows.filter((row) => row.action === 'STUDENT_LOGIN').length >= 2);
    assert.ok(audit.rows.every((row) => row.actor_student_id === enrollment.studentId));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
