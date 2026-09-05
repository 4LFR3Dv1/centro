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
const TEST_DOCUMENT = '98765432100';
const TEST_IDENTITY = 'RG-STUDENT-DETAIL-002';
const TEST_RENACH = 'RENACHSTUD002';

function cookieValue(setCookie: string | null): string {
  assert.ok(setCookie, 'login must return Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1 OR cpf_normalized = $1', [TEST_DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);

  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
  }

  for (const studentId of studentIds) {
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = $1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1) OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollment_intake_observations WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  if (staffId) await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
}

test('STUDENT-DETAIL-002 workspace projects modern institutional Student and Enrollment facts without credential secrets', async () => {
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
    cpf: TEST_DOCUMENT,
    birthDate: '1998-05-14',
    identityDocument: {
      type: 'RG',
      number: TEST_IDENTITY,
      uf: 'SP',
    },
    address: {
      postalCode: '01001000',
      street: 'Praça da Sé',
      number: '100',
      complement: 'Sala 2',
    },
    intake: {
      situation: 'THEORY_EXAM_PASSED',
      renach: TEST_RENACH,
    },
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'STUDENT-DETAIL-002 witness',
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
    assert.equal(byPublicIdBody.students[0].cpf, TEST_DOCUMENT);
    assert.equal(byPublicIdBody.students[0].activeEnrollments, 1);
    assert.equal('passwordHash' in byPublicIdBody.students[0], false);

    const byIdentity = await fetch(`${base}/api/admin/students?q=${encodeURIComponent(TEST_IDENTITY)}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(byIdentity.status, 200);
    const byIdentityBody = await byIdentity.json() as { students: Array<{ id: string }> };
    assert.equal(byIdentityBody.students.length, 1);
    assert.equal(byIdentityBody.students[0].id, receipt.studentId);

    const detail = await fetch(`${base}/api/admin/students/${receipt.studentId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as {
      student: {
        publicId: string;
        totalEnrollments: number;
        cpf: string | null;
        birthDate: string | null;
        identityDocument: { type: string; number: string; uf: string | null } | null;
        address: { postalCode: string | null; street: string | null; number: string | null; complement: string | null } | null;
      };
      credential: Record<string, unknown> & { exists: boolean; mustChangePassword: boolean; passwordVersion: number | null };
      enrollments: Array<{
        id: string;
        serviceType: string;
        category: string;
        status: string;
        renach: string | null;
        intakeObservations: Array<{ kind: string; value: string | null }>;
      }>;
      recentAudit: Array<{ action: string; entityType: string }>;
    };

    assert.equal(detailBody.student.publicId, receipt.studentPublicId);
    assert.equal(detailBody.student.totalEnrollments, 1);
    assert.equal(detailBody.student.cpf, TEST_DOCUMENT);
    assert.equal(detailBody.student.birthDate, '1998-05-14');
    assert.deepEqual(detailBody.student.identityDocument, { type: 'RG', number: TEST_IDENTITY, uf: 'SP' });
    assert.deepEqual(detailBody.student.address, {
      postalCode: '01001000',
      street: 'Praça da Sé',
      number: '100',
      complement: 'Sala 2',
    });
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
    assert.equal(detailBody.enrollments[0].renach, TEST_RENACH);
    assert.deepEqual(
      detailBody.enrollments[0].intakeObservations.map((observation) => observation.kind),
      ['DETRAN_PROCESS_STARTED', 'RENACH_OBSERVED', 'THEORY_COURSE_COMPLETED', 'THEORY_EXAM_PASSED'],
    );
    assert.equal(
      detailBody.enrollments[0].intakeObservations.find((observation) => observation.kind === 'RENACH_OBSERVED')?.value,
      TEST_RENACH,
    );
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'STUDENT_CREATED'));
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'ENROLLMENT_CREATED'));
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'STUDENT_ACCESS_QR_CREATED'));
    assert.ok(detailBody.recentAudit.some((event) => event.action === 'ENROLLMENT_INTAKE_RECORDED'));

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
