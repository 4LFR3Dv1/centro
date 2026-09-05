import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { authenticateStudent, resolveStudentSession } from '../student/auth.js';
import { createStudentAccessApiHandler } from './student-access-api.js';

const ORIGIN = 'https://centro.test';
const suffix = randomBytes(5).toString('hex');
const ADMIN_USER = `access-qr-${suffix}`;
const ADMIN_PASSWORD = `Acesso-${randomBytes(12).toString('base64url')}!9`;
const STUDENT_PASSWORD = `Aluno-${randomBytes(15).toString('base64url')}!7`;
const DOCUMENT = `77${String(Date.now()).slice(-9)}`;

async function cleanup(pool: ReturnType<typeof createDatabasePool>) {
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [DOCUMENT]);
  for (const row of students.rows) {
    const enrollmentIds = (await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = $1', [row.id])).rows.map((item) => item.id);
    const qrIds = (await pool.query<{ id: string }>('SELECT id FROM student_access_qrs WHERE student_id = $1', [row.id])).rows.map((item) => item.id);
    const entityIds = [row.id, ...enrollmentIds, ...qrIds];
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = ANY($2::uuid[])', [row.id, entityIds]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [row.id]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [row.id]);
    await pool.query('DELETE FROM students WHERE id = $1', [row.id]);
  }

  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  for (const row of staff.rows) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [row.id]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [row.id]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [row.id]);
  }
}

function adminCookie(token: string) {
  return `centro_admin_session=${encodeURIComponent(token)}`;
}

function cookieValue(setCookie: string | null, name: string): string {
  assert.ok(setCookie);
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  assert.ok(match);
  return decodeURIComponent(match[1]);
}

test('ACCESS-002 enrollment has no password; first active QR creates credential + session exactly once', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Access QR Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const first = await materializeEnrollment(pool, {
    fullName: 'Aluno QR Persistente',
    phone: '11999990000',
    email: 'qr@example.test',
    document: DOCUMENT,
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.equal(first.credentialExists, false);
  assert.equal(first.activationRequired, true);
  assert.equal(first.initialPassword, null);
  assert.equal(first.accessQr.created, true);

  const credentialBefore = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM student_credentials WHERE student_id = $1',
    [first.studentId],
  );
  assert.equal(credentialBefore.rows[0]?.count, '0');

  const handler = createStudentAccessApiHandler(pool, { publicOrigin: ORIGIN, secureCookies: false });
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled && !res.writableEnded) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const publicResolve = await fetch(`${base}/api/student/access/${first.accessQr.publicToken}`);
    assert.equal(publicResolve.status, 200);
    assert.equal(publicResolve.headers.get('set-cookie'), null, 'GET QR resolution must never authenticate');
    const initialResolution = await publicResolve.json() as { publicId: string; firstName: string; activationRequired: boolean };
    assert.equal(initialResolution.publicId, first.studentPublicId);
    assert.equal(initialResolution.firstName, 'Aluno');
    assert.equal(initialResolution.activationRequired, true);

    const directLoginBefore = await authenticateStudent(pool, first.studentPublicId, STUDENT_PASSWORD);
    assert.equal(directLoginBefore, null, 'a password cannot authenticate before activation because no credential exists');

    const auth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
    assert.ok(auth);
    const staffCookie = adminCookie(auth.token);

    // Staff may rotate a card before activation; the new QR remains an activation capability.
    const rotateBefore = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr/rotate`, {
      method: 'POST',
      headers: { Cookie: staffCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rotateBefore.status, 200);
    const rotateBeforeBody = await rotateBefore.json() as { qr: { publicToken: string; activationRequired: boolean; activatedAt: string | null } };
    assert.notEqual(rotateBeforeBody.qr.publicToken, first.accessQr.publicToken);
    assert.equal(rotateBeforeBody.qr.activationRequired, true);
    assert.equal(rotateBeforeBody.qr.activatedAt, null);

    const oldBeforeActivation = await fetch(`${base}/api/student/access/${first.accessQr.publicToken}`);
    assert.equal(oldBeforeActivation.status, 410);

    const activeToken = rotateBeforeBody.qr.publicToken;
    const activeResolve = await fetch(`${base}/api/student/access/${activeToken}`);
    assert.equal(activeResolve.status, 200);
    assert.equal((await activeResolve.json() as { activationRequired: boolean }).activationRequired, true);

    const wrongOrigin = await fetch(`${base}/api/student/access/${activeToken}/activate`, {
      method: 'POST',
      headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: STUDENT_PASSWORD }),
    });
    assert.equal(wrongOrigin.status, 403);

    const shortPassword = await fetch(`${base}/api/student/access/${activeToken}/activate`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'curta' }),
    });
    assert.equal(shortPassword.status, 400);

    const activation = await fetch(`${base}/api/student/access/${activeToken}/activate`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: STUDENT_PASSWORD }),
    });
    assert.equal(activation.status, 201);
    const activationBody = await activation.json() as {
      student: { id: string; publicId: string };
      credential: { mustChangePassword: boolean };
      nextAction: null;
    };
    assert.equal(activationBody.student.id, first.studentId);
    assert.equal(activationBody.student.publicId, first.studentPublicId);
    assert.equal(activationBody.credential.mustChangePassword, false);
    assert.equal(activationBody.nextAction, null);

    const studentToken = cookieValue(activation.headers.get('set-cookie'), 'centro_student_session');
    const resolvedSession = await resolveStudentSession(pool, studentToken);
    assert.ok(resolvedSession);
    assert.equal(resolvedSession.studentId, first.studentId);
    assert.equal(resolvedSession.mustChangePassword, false);

    const credentialAfter = await pool.query<{ password_hash: string; must_change_password: boolean }>(
      'SELECT password_hash, must_change_password FROM student_credentials WHERE student_id = $1',
      [first.studentId],
    );
    assert.match(credentialAfter.rows[0]?.password_hash ?? '', /^\$argon2id\$/);
    assert.equal(credentialAfter.rows[0]?.password_hash.includes(STUDENT_PASSWORD), false);
    assert.equal(credentialAfter.rows[0]?.must_change_password, false);

    const qrAfter = await pool.query<{ activated_at: Date | null }>(
      'SELECT activated_at FROM student_access_qrs WHERE public_token = $1',
      [activeToken],
    );
    assert.ok(qrAfter.rows[0]?.activated_at);

    const resolvedAfter = await fetch(`${base}/api/student/access/${activeToken}`);
    assert.equal(resolvedAfter.status, 200);
    assert.equal((await resolvedAfter.json() as { activationRequired: boolean }).activationRequired, false);

    const duplicateActivation = await fetch(`${base}/api/student/access/${activeToken}/activate`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: STUDENT_PASSWORD }),
    });
    assert.equal(duplicateActivation.status, 409);

    const normalLogin = await authenticateStudent(pool, first.studentPublicId, STUDENT_PASSWORD);
    assert.ok(normalLogin, 'password chosen during activation becomes the normal portal credential');

    const second = await materializeEnrollment(pool, {
      fullName: 'Aluno QR Persistente',
      phone: '11999990001',
      email: 'qr@example.test',
      document: DOCUMENT,
      serviceType: 'LICENSED_TRAINING',
      category: 'B',
      actorStaffUserId: bootstrap.staffUserId,
    });
    assert.equal(second.studentId, first.studentId);
    assert.equal(second.credentialExists, true);
    assert.equal(second.activationRequired, false);
    assert.equal(second.initialPassword, null);
    assert.equal(second.accessQr.publicToken, activeToken);

    // Rotation after activation produces a locator-only QR; it must never ask the Student to set another password.
    const rotateAfter = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr/rotate`, {
      method: 'POST',
      headers: { Cookie: staffCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rotateAfter.status, 200);
    const rotateAfterBody = await rotateAfter.json() as { qr: { publicToken: string; activationRequired: boolean; activatedAt: string | null } };
    assert.equal(rotateAfterBody.qr.activationRequired, false);
    assert.ok(rotateAfterBody.qr.activatedAt);

    const oldActivePublic = await fetch(`${base}/api/student/access/${activeToken}`);
    assert.equal(oldActivePublic.status, 410);
    const finalPublic = await fetch(`${base}/api/student/access/${rotateAfterBody.qr.publicToken}`);
    assert.equal(finalPublic.status, 200);
    assert.equal((await finalPublic.json() as { activationRequired: boolean }).activationRequired, false);

    const oldStaffLookup = await fetch(`${base}/api/admin/student-access/lookup`, {
      method: 'POST',
      headers: { Cookie: staffCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: first.accessQr.publicToken }),
    });
    assert.equal(oldStaffLookup.status, 200);
    const oldStaffBody = await oldStaffLookup.json() as { student: { id: string }; qr: { active: boolean } };
    assert.equal(oldStaffBody.student.id, first.studentId);
    assert.equal(oldStaffBody.qr.active, false);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE actor_student_id = $1 OR actor_staff_user_id = $2`,
      [first.studentId, bootstrap.staffUserId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_ACCESS_ACTIVATED'));
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_LOGIN'));
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_ACCESS_QR_ROTATED'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
