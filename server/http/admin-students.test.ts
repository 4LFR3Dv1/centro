import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { createAdminApiHandler } from './admin-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'admin-students-test';
const ADMIN_PASSWORD = `Admin-${randomUUID()}-Test`;
const TEST_DOCUMENT = '9'.repeat(11);

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
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = $1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1) OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  if (staffId) await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
}

test('ADMIN-003 workspace projects Student facts and pre-activation state without credential secrets', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Admin Students Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const receipt = await materializeEnrollment(pool, {
    fullName: 'Ana Workspace Test',
    phone: '1'.repeat(11),
    email: 'ana.workspace@example.test',
    document: TEST_DOCUMENT,
    birthDate: '1998-05-14',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'ADMIN-003 witness',
    actorStaffUserId: bootstrap.staffUserId,
  });

  assert.equal(receipt.credentialCreated, false);
  assert.equal(receipt.initialPassword, null);
  assert.equal(receipt.activationRequired, true);

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
    const unauthenticated = await fetch(`${base}/api/admin/students`);
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieValue(login.headers.get('set-cookie'));

    const byPublicId = await fetch(`${base}/api/admin/students?q=${encodeURIComponent(receipt.studentPublicId)}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(byPublicId.status, 200);
    const byPublicIdBody = await byPublicId.json() as { students: Array<Record<string, unknown>> };
    assert.equal(byPublicIdBody.students.length, 1);
    assert.equal(byPublicIdBody.students[0].publicId, receipt.studentPublicId);
    assert.equal(byPublicIdBody.students[0].fullName, 'Ana Workspace Test');
    assert.equal(byPublicIdBody.students[0].document, TEST_DOCUMENT);
    assert.equal(byPublicIdBody.students[0].activeEnrollments, 1);
    assert.equal('passwordHash' in byPublicIdBody.students[0], false);

    const byDocument = await fetch(`${base}/api/admin/students?q=${encodeURIComponent(TEST_DOCUMENT)}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(byDocument.status, 200);
    const byDocumentBody = await byDocument.json() as { students: Array<{ id: string }> };
    assert.equal(byDocumentBody.students.length, 1);
    assert.equal(byDocumentBody.students[0].id, receipt.studentId);

    const detail = await fetch(`${base}/api/admin/students/${receipt.studentId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as {
      student: { publicId: string; totalEnrollments: number };
      credential: Record<string, unknown> & { exists: boolean; mustChangePassword: boolean; passwordVersion: number | null };
      enrollments: Array<{ id: string; serviceType: string; category: string; status: string }>;
      recentAudit: Array<{ action: string; entityType: string }>;
    };

    assert.equal(detailBody.student.publicId, receipt.studentPublicId);
    assert.equal(detailBody.student.totalEnrollments, 1);
    assert.equal(detailBody.credential.exists, false);
    assert.equal(detailBody.credential.mustChangePassword, false);
    assert.equal(detailBody.credential.passwordVersion, null);
    assert.equal('passwordHash' in detailBody.credential, false);
    assert.equal('initialPassword' in detailBody.credential, false);
    assert.equal(detailBody.enrollments.length, 1);
    assert.equal(detailBody.enrollments[0].id, receipt.enrollmentId);
    assert.equal(detailBody.enrollments[0].serviceType, 'FIRST_LICENSE');
    assert.equal(detailBody.enrollments[0].category, 'B');
    assert.equal(detailBody.enrollments[0].status, 'ACTIVE');
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'STUDENT_CREATED'));
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'ENROLLMENT_CREATED'));
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'STUDENT_ACCESS_QR_CREATED'));

    const missing = await fetch(`${base}/api/admin/students/00000000-0000-4000-8000-000000000000`, {
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
