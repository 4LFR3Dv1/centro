import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { createProcessApiHandler } from './process-api.js';
import { createAdminTheoryExamsApiHandler } from './admin-theory-exams.js';

const ORIGIN = 'https://centro-theory.test';
const ADMIN_USER = 'theory-exam-001-admin';
const ADMIN_PASSWORD = `Theory-${randomUUID()}-Admin`;
const DOCUMENT = '52998224725';

function cookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1 OR cpf_normalized = $1', [DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);
  if (studentIds.length > 0) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = ANY($1::uuid[])', [studentIds]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    if (enrollmentIds.length > 0) {
      await pool.query('DELETE FROM theory_exam_attempts WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id = ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM student_access_qrs WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM student_credentials WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM sessions WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }
  if (staffId) {
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

async function post(base: string, path: string, token: string, body: unknown = {}, origin = ORIGIN) {
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

test('THEORY-EXAM-001 preserves failed/absent attempts and advances only on official approval', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);
  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'THEORY-EXAM-001 Admin',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const receipt = await materializeEnrollment(pool, {
    fullName: 'Theory Exam Witness Student',
    phone: '11977776666',
    email: 'theory-exam-witness@example.test',
    document: DOCUMENT,
    birthDate: '2000-04-22',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'THEORY-EXAM-001 witness',
    actorStaffUserId: bootstrap.staffUserId,
  });
  const auth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
  assert.ok(auth);

  const processApi = createProcessApiHandler(pool, { publicOrigin: ORIGIN });
  const theoryApi = createAdminTheoryExamsApiHandler(pool, { publicOrigin: ORIGIN });
  const server = createServer((req, res) => {
    void (async () => {
      if (await theoryApi(req, res)) return;
      if (await processApi(req, res)) return;
      res.statusCode = 404;
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const anonymous = await fetch(`${base}/api/admin/theory-exams?enrollmentId=${receipt.enrollmentId}`);
    assert.equal(anonymous.status, 401);

    const registration = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/REGISTRATION_DONE/achieve`, auth.token);
    assert.equal(registration.status, 200);
    const health = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/HEALTH_DONE/achieve`, auth.token);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).process.currentState.code, 'THEORY_PASSED');

    const rejectedOrigin = await post(base, '/api/admin/theory-exams', auth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: new Date(Date.now() + 86400000).toISOString(),
    }, 'https://evil.test');
    assert.equal(rejectedOrigin.status, 403);

    const firstAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const firstResponse = await post(base, '/api/admin/theory-exams', auth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: firstAt,
      bookingSource: 'SCHOOL',
      protocol: 'THEORY-001-A',
    });
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json() as any).attempt;
    assert.equal(first.enrollmentId, receipt.enrollmentId);
    assert.equal(first.attendanceStatus, 'PENDING');

    const duplicateOpen = await post(base, '/api/admin/theory-exams', auth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    assert.equal(duplicateOpen.status, 409);

    const scheduleFact = await pool.query<{ scheduled_for: Date }>(
      `SELECT scheduled_for FROM enrollment_milestones WHERE enrollment_id = $1 AND code = 'THEORY_PASSED'`,
      [receipt.enrollmentId],
    );
    assert.equal(scheduleFact.rows[0]?.scheduled_for.toISOString(), firstAt);

    const present = await post(base, `/api/admin/theory-exams/${first.id}/attendance`, auth.token, { attendanceStatus: 'PRESENT' });
    assert.equal(present.status, 200);
    const observedFail = await post(base, `/api/admin/theory-exams/${first.id}/observed-result`, auth.token, { result: 'FAILED' });
    assert.equal(observedFail.status, 200);
    const officialFail = await post(base, `/api/admin/theory-exams/${first.id}/official-result`, auth.token, { result: 'FAILED' });
    assert.equal(officialFail.status, 200);
    assert.ok((await officialFail.json() as any).attempt.resolvedAt);

    const afterFail = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, {
      headers: { Cookie: cookie('centro_admin_session', auth.token) },
    });
    assert.equal(afterFail.status, 200);
    const afterFailProcess = (await afterFail.json() as any).process;
    assert.equal(afterFailProcess.currentState.code, 'THEORY_PASSED');
    assert.equal(afterFailProcess.milestones.find((m: any) => m.code === 'THEORY_PASSED').scheduledFor, null);

    const absentAt = new Date(Date.now() + 4 * 86400000).toISOString();
    const absentAttemptResponse = await post(base, '/api/admin/theory-exams', auth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: absentAt,
    });
    assert.equal(absentAttemptResponse.status, 201);
    const absentAttempt = (await absentAttemptResponse.json() as any).attempt;
    const absent = await post(base, `/api/admin/theory-exams/${absentAttempt.id}/attendance`, auth.token, { attendanceStatus: 'ABSENT' });
    assert.equal(absent.status, 200);
    assert.ok((await absent.json() as any).attempt.resolvedAt);

    const approvedAt = new Date(Date.now() + 6 * 86400000).toISOString();
    const approvedAttemptResponse = await post(base, '/api/admin/theory-exams', auth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: approvedAt,
      protocol: 'THEORY-001-C',
    });
    assert.equal(approvedAttemptResponse.status, 201);
    const approvedAttempt = (await approvedAttemptResponse.json() as any).attempt;
    assert.equal((await post(base, `/api/admin/theory-exams/${approvedAttempt.id}/attendance`, auth.token, { attendanceStatus: 'PRESENT' })).status, 200);
    assert.equal((await post(base, `/api/admin/theory-exams/${approvedAttempt.id}/observed-result`, auth.token, { result: 'APPROVED' })).status, 200);
    const approved = await post(base, `/api/admin/theory-exams/${approvedAttempt.id}/official-result`, auth.token, { result: 'APPROVED' });
    assert.equal(approved.status, 200);

    const processAfterApproval = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, {
      headers: { Cookie: cookie('centro_admin_session', auth.token) },
    });
    assert.equal(processAfterApproval.status, 200);
    assert.equal((await processAfterApproval.json() as any).process.currentState.code, 'PRACTICE_DONE');

    const history = await fetch(`${base}/api/admin/theory-exams?enrollmentId=${receipt.enrollmentId}`, {
      headers: { Cookie: cookie('centro_admin_session', auth.token) },
    });
    assert.equal(history.status, 200);
    const attempts = (await history.json() as any).attempts;
    assert.equal(attempts.length, 3);
    assert.ok(attempts.some((attempt: any) => attempt.officialResult === 'FAILED'));
    assert.ok(attempts.some((attempt: any) => attempt.attendanceStatus === 'ABSENT'));
    assert.ok(attempts.some((attempt: any) => attempt.officialResult === 'APPROVED'));

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE actor_staff_user_id = $1 ORDER BY occurred_at`,
      [bootstrap.staffUserId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'THEORY_EXAM_ATTEMPT_CREATED'));
    assert.ok(audit.rows.some((row) => row.action === 'THEORY_EXAM_RESULT_RECONCILED'));
    assert.ok(audit.rows.some((row) => row.action === 'PROCESS_MILESTONE_ACHIEVED'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
