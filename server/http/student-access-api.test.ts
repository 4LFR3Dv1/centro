import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { createStudentAccessApiHandler } from './student-access-api.js';

const ORIGIN = 'https://centro.test';
const suffix = randomBytes(5).toString('hex');
const ADMIN_USER = `access-qr-${suffix}`;
const ADMIN_PASSWORD = `Acesso-${randomBytes(12).toString('base64url')}!9`;
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

function cookie(token: string) {
  return `centro_admin_session=${encodeURIComponent(token)}`;
}

test('ACCESS-001 persists one Student QR, resolves public identity, supports Staff lookup and rotation', async () => {
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
  assert.equal(first.credentialCreated, true);
  assert.ok(first.initialPassword);
  assert.equal(first.accessQr.created, true);
  assert.ok(first.accessQr.publicToken.length >= 20);

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
  assert.equal(second.credentialCreated, false);
  assert.equal(second.initialPassword, null);
  assert.equal(second.accessQr.created, false);
  assert.equal(second.accessQr.publicToken, first.accessQr.publicToken);

  const activeBefore = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM student_access_qrs WHERE student_id = $1 AND revoked_at IS NULL',
    [first.studentId],
  );
  assert.equal(Number(activeBefore.rows[0].count), 1);

  const handler = createStudentAccessApiHandler(pool, { publicOrigin: ORIGIN });
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
    assert.equal(publicResolve.headers.get('set-cookie'), null, 'QR resolution must not authenticate');
    assert.deepEqual(await publicResolve.json(), { publicId: first.studentPublicId });

    const anonymousAdmin = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr`);
    assert.equal(anonymousAdmin.status, 401);

    const auth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
    assert.ok(auth);
    const adminCookie = cookie(auth.token);

    const current = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr`, { headers: { Cookie: adminCookie } });
    assert.equal(current.status, 200);
    const currentBody = await current.json() as { qr: { publicToken: string } };
    assert.equal(currentBody.qr.publicToken, first.accessQr.publicToken);

    const lookup = await fetch(`${base}/api/admin/student-access/lookup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: `${ORIGIN}/aluno/acesso/${first.accessQr.publicToken}` }),
    });
    assert.equal(lookup.status, 200);
    const lookupBody = await lookup.json() as { student: { id: string; publicId: string }; qr: { active: boolean } };
    assert.equal(lookupBody.student.id, first.studentId);
    assert.equal(lookupBody.student.publicId, first.studentPublicId);
    assert.equal(lookupBody.qr.active, true);

    const wrongOrigin = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr/rotate`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(wrongOrigin.status, 403);

    const rotate = await fetch(`${base}/api/admin/students/${first.studentId}/access-qr/rotate`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rotate.status, 200);
    const rotateBody = await rotate.json() as { qr: { publicToken: string } };
    assert.notEqual(rotateBody.qr.publicToken, first.accessQr.publicToken);

    const oldPublic = await fetch(`${base}/api/student/access/${first.accessQr.publicToken}`);
    assert.equal(oldPublic.status, 410);

    const oldStaffLookup = await fetch(`${base}/api/admin/student-access/lookup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: first.accessQr.publicToken }),
    });
    assert.equal(oldStaffLookup.status, 200);
    const oldStaffBody = await oldStaffLookup.json() as { student: { id: string }; qr: { active: boolean } };
    assert.equal(oldStaffBody.student.id, first.studentId);
    assert.equal(oldStaffBody.qr.active, false);

    const newPublic = await fetch(`${base}/api/student/access/${rotateBody.qr.publicToken}`);
    assert.equal(newPublic.status, 200);
    assert.deepEqual(await newPublic.json(), { publicId: first.studentPublicId });

    const activeAfter = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM student_access_qrs WHERE student_id = $1 AND revoked_at IS NULL',
      [first.studentId],
    );
    assert.equal(Number(activeAfter.rows[0].count), 1);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE actor_staff_user_id = $1
         AND action IN ('STUDENT_ACCESS_QR_CREATED', 'STUDENT_ACCESS_QR_ROTATED')`,
      [bootstrap.staffUserId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_ACCESS_QR_CREATED'));
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_ACCESS_QR_ROTATED'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
