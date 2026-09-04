import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { achieveProcessMilestone } from '../process/resolver.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { authenticateStudent, changeInitialStudentPassword } from '../student/auth.js';
import { createStudentGuideApiHandler } from './student-guide-api.js';

const ORIGIN = 'https://centro-docs.test';
const ADMIN_USER = 'docs-001-admin';
const ADMIN_PASSWORD = `Docs-${randomUUID()}-Admin`;
const DOCUMENT_A = '98765432171';
const DOCUMENT_B = '98765432172';

function cookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>(
    'SELECT id FROM students WHERE document_normalized = ANY($1::text[])',
    [[DOCUMENT_A, DOCUMENT_B]],
  );
  const studentIds = students.rows.map((row) => row.id);

  if (studentIds.length > 0) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = ANY($1::uuid[])', [studentIds]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    await pool.query('DELETE FROM student_guides WHERE student_id = ANY($1::uuid[])', [studentIds]);
    if (enrollmentIds.length > 0) {
      await pool.query('DELETE FROM lessons WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id = ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query('DELETE FROM sessions WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }

  if (staffId) {
    await pool.query('DELETE FROM student_guides WHERE generated_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

async function adminPost(base: string, path: string, token: string, body: unknown, origin = ORIGIN) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie('centro_admin_session', token),
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('DOCS-001 versions a Student Guide snapshot and exposes only authorized Student copies', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'DOCS-001 Admin',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const receiptA = await materializeEnrollment(pool, {
    fullName: 'Docs Witness Student A',
    phone: '12999991001',
    email: 'docs-a@example.test',
    document: DOCUMENT_A,
    birthDate: '2001-02-03',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'DOCS-001 A',
    actorStaffUserId: bootstrap.staffUserId,
  });
  const receiptB = await materializeEnrollment(pool, {
    fullName: 'Docs Witness Student B',
    phone: '12999991002',
    email: 'docs-b@example.test',
    document: DOCUMENT_B,
    birthDate: '2002-03-04',
    serviceType: 'FIRST_LICENSE',
    category: 'A',
    notes: 'DOCS-001 B',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.ok(receiptA.initialPassword);
  assert.ok(receiptB.initialPassword);

  const staffAuth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
  const studentAAuth = await authenticateStudent(pool, receiptA.studentPublicId, receiptA.initialPassword!);
  const studentBAuth = await authenticateStudent(pool, receiptB.studentPublicId, receiptB.initialPassword!);
  assert.ok(staffAuth);
  assert.ok(studentAAuth);
  assert.ok(studentBAuth);

  const handler = createStudentGuideApiHandler(pool, { publicOrigin: ORIGIN });
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
  const adminCookie = cookie('centro_admin_session', staffAuth.token);
  const studentACookie = cookie('centro_student_session', studentAAuth.token);

  try {
    const anonymousPreview = await fetch(
      `${base}/api/admin/guides/preview?studentId=${receiptA.studentId}&enrollmentId=${receiptA.enrollmentId}`,
    );
    assert.equal(anonymousPreview.status, 401);

    const preview = await fetch(
      `${base}/api/admin/guides/preview?studentId=${receiptA.studentId}&enrollmentId=${receiptA.enrollmentId}`,
      { headers: { Cookie: adminCookie } },
    );
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { template: any; snapshot: any };
    assert.equal(previewBody.template.id, 'CENTRO_STUDENT_GUIDE');
    assert.equal(previewBody.template.version, 1);
    assert.equal(previewBody.snapshot.student.publicId, receiptA.studentPublicId);
    assert.equal(previewBody.snapshot.process.currentState.code, 'REGISTRATION_DONE');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM student_guides')).rows[0].count, 0);

    const wrongOrigin = await adminPost(
      base,
      '/api/admin/guides',
      staffAuth.token,
      { studentId: receiptA.studentId, enrollmentId: receiptA.enrollmentId },
      'https://wrong-origin.test',
    );
    assert.equal(wrongOrigin.status, 403);

    const generatedA = await adminPost(base, '/api/admin/guides', staffAuth.token, {
      studentId: receiptA.studentId,
      enrollmentId: receiptA.enrollmentId,
    });
    assert.equal(generatedA.status, 201);
    const generatedABody = await generatedA.json() as { receipt: any; guide: any };
    assert.match(generatedABody.receipt.contentSha256, /^[0-9a-f]{64}$/);
    assert.equal(generatedABody.guide.snapshot.process.currentState.code, 'REGISTRATION_DONE');
    const firstGuideId = generatedABody.receipt.guideId as string;
    const firstDigest = generatedABody.receipt.contentSha256 as string;

    const stored = await pool.query<{ template_id: string; template_version: number; content_sha256: string }>(
      'SELECT template_id, template_version, content_sha256 FROM student_guides WHERE id = $1',
      [firstGuideId],
    );
    assert.equal(stored.rows[0].template_id, 'CENTRO_STUDENT_GUIDE');
    assert.equal(stored.rows[0].template_version, 1);
    assert.equal(stored.rows[0].content_sha256, firstDigest);

    const gatedStudent = await fetch(`${base}/api/student/guides`, { headers: { Cookie: studentACookie } });
    assert.equal(gatedStudent.status, 403);

    await changeInitialStudentPassword(pool, studentAAuth.session, `Permanent-A-${randomUUID()}-Password`);
    await changeInitialStudentPassword(pool, studentBAuth.session, `Permanent-B-${randomUUID()}-Password`);

    const studentList = await fetch(`${base}/api/student/guides`, { headers: { Cookie: studentACookie } });
    assert.equal(studentList.status, 200);
    const studentListBody = await studentList.json() as { guides: any[] };
    assert.equal(studentListBody.guides.length, 1);
    assert.equal(studentListBody.guides[0].id, firstGuideId);

    const generatedB = await adminPost(base, '/api/admin/guides', staffAuth.token, {
      studentId: receiptB.studentId,
      enrollmentId: receiptB.enrollmentId,
    });
    assert.equal(generatedB.status, 201);
    const generatedBBody = await generatedB.json() as { receipt: any };

    const crossStudent = await fetch(`${base}/api/student/guides/${generatedBBody.receipt.guideId}`, {
      headers: { Cookie: studentACookie },
    });
    assert.equal(crossStudent.status, 404);

    await achieveProcessMilestone(pool, {
      enrollmentId: receiptA.enrollmentId,
      code: 'REGISTRATION_DONE',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const changedPreview = await fetch(
      `${base}/api/admin/guides/preview?studentId=${receiptA.studentId}&enrollmentId=${receiptA.enrollmentId}`,
      { headers: { Cookie: adminCookie } },
    );
    assert.equal(changedPreview.status, 200);
    assert.equal((await changedPreview.json() as any).snapshot.process.currentState.code, 'HEALTH_DONE');

    const oldVersion = await fetch(`${base}/api/student/guides/${firstGuideId}`, { headers: { Cookie: studentACookie } });
    assert.equal(oldVersion.status, 200);
    const oldVersionBody = await oldVersion.json() as { guide: any };
    assert.equal(oldVersionBody.guide.snapshot.process.currentState.code, 'REGISTRATION_DONE');
    assert.equal(oldVersionBody.guide.contentSha256, firstDigest);

    const generatedA2 = await adminPost(base, '/api/admin/guides', staffAuth.token, {
      studentId: receiptA.studentId,
      enrollmentId: receiptA.enrollmentId,
    });
    assert.equal(generatedA2.status, 201);
    const generatedA2Body = await generatedA2.json() as { receipt: any; guide: any };
    assert.equal(generatedA2Body.guide.snapshot.process.currentState.code, 'HEALTH_DONE');
    assert.notEqual(generatedA2Body.receipt.contentSha256, firstDigest);

    const finalList = await fetch(`${base}/api/student/guides`, { headers: { Cookie: studentACookie } });
    assert.equal(finalList.status, 200);
    const finalListBody = await finalList.json() as { guides: any[] };
    assert.equal(finalListBody.guides.length, 2);
    assert.equal(finalListBody.guides[0].snapshot.process.currentState.code, 'HEALTH_DONE');
    assert.equal(finalListBody.guides[1].snapshot.process.currentState.code, 'REGISTRATION_DONE');

    const audit = await pool.query<{ action: string; metadata: any }>(
      `SELECT action, metadata FROM audit_events
       WHERE actor_staff_user_id = $1 AND action = 'STUDENT_GUIDE_GENERATED'
       ORDER BY occurred_at`,
      [bootstrap.staffUserId],
    );
    assert.equal(audit.rows.length, 3);
    assert.ok(audit.rows.every((row) => row.metadata.templateId === 'CENTRO_STUDENT_GUIDE'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
