import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { activateStudentAccessQr } from '../student/access.js';
import { createAdminExamsApiHandler } from './admin-exams.js';
import { createAdminTheoryExamsApiHandler } from './admin-theory-exams.js';
import { createProcessApiHandler } from './process-api.js';

const ORIGIN = 'https://centro-process.test';
const ADMIN_USER = 'process-001-admin';
const ADMIN_PASSWORD = `Process-${randomUUID()}-Admin`;
const DOCUMENT = '98765432109';

function cookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);

  if (studentIds.length > 0) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = ANY($1::uuid[])', [studentIds]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    if (enrollmentIds.length > 0) {
      const sessionRows = await pool.query<{ session_id: string }>(
        'SELECT DISTINCT session_id FROM practical_exam_candidates WHERE enrollment_id = ANY($1::uuid[])',
        [enrollmentIds],
      );
      const sessionIds = sessionRows.rows.map((row) => row.session_id);
      await pool.query('DELETE FROM practical_exam_candidates WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      if (sessionIds.length > 0) await pool.query('DELETE FROM practical_exam_sessions WHERE id = ANY($1::uuid[])', [sessionIds]);
      await pool.query('DELETE FROM theory_exam_attempts WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM lessons WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id = ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query('DELETE FROM sessions WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[]) OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = ANY($1::uuid[]))', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }

  if (staffId) {
    await pool.query('DELETE FROM theory_exam_attempts WHERE created_by_staff_user_id = $1 OR updated_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM practical_exam_candidates WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM practical_exam_sessions WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM lessons WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM enrollment_milestones WHERE updated_by_staff_user_id = $1 OR achieved_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }

  await pool.query(`DELETE FROM instructor_categories WHERE instructor_id IN (SELECT id FROM instructors WHERE display_name LIKE 'PROCESS-001 %')`);
  await pool.query(`DELETE FROM vehicles WHERE label LIKE 'PROCESS-001 %'`);
  await pool.query(`DELETE FROM instructors WHERE display_name LIKE 'PROCESS-001 %'`);
}

async function post(base: string, path: string, adminToken: string, body: unknown = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie('centro_admin_session', adminToken),
      Origin: ORIGIN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('PROCESS owner cutover keeps Process derived while theory and practical exams own their official facts', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'PROCESS-001 Admin',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const receipt = await materializeEnrollment(pool, {
    fullName: 'Process Witness Student',
    phone: '12999990000',
    email: 'process-witness@example.test',
    document: DOCUMENT,
    birthDate: '2001-06-04',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'PROCESS owner-domain witness',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.equal(receipt.activationRequired, true);

  const staffAuth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
  assert.ok(staffAuth);
  const studentActivation = await activateStudentAccessQr(pool, {
    publicToken: receipt.accessQr.publicToken,
    password: `Process-${randomUUID()}-Student`,
  });

  const examsHandler = createAdminExamsApiHandler(pool, { publicOrigin: ORIGIN });
  const theoryHandler = createAdminTheoryExamsApiHandler(pool, { publicOrigin: ORIGIN });
  const processHandler = createProcessApiHandler(pool, { publicOrigin: ORIGIN });
  const server = createServer((req, res) => {
    void (async () => {
      if (await examsHandler(req, res)) return;
      if (await theoryHandler(req, res)) return;
      if (await processHandler(req, res)) return;
      if (!res.writableEnded) {
        res.statusCode = 404;
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const adminCookie = cookie('centro_admin_session', staffAuth.token);
  const studentCookie = cookie('centro_student_session', studentActivation.token);

  const instructorId = randomUUID();
  const vehicleId = randomUUID();
  const lessonId = randomUUID();

  try {
    assert.equal((await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`)).status, 401);

    const initial = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, { headers: { Cookie: adminCookie } });
    assert.equal(initial.status, 200);
    const initialProcess = (await initial.json() as any).process;
    assert.equal(initialProcess.currentState.code, 'REGISTRATION_DONE');
    assert.equal(initialProcess.currentState.percent, 14);

    const theoryBypass = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/achieve`, staffAuth.token);
    assert.equal(theoryBypass.status, 409);
    assert.match((await theoryBypass.json() as any).error, /THEORY-EXAM-001/);

    assert.equal((await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/REGISTRATION_DONE/achieve`, staffAuth.token)).status, 200);
    const health = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/HEALTH_DONE/achieve`, staffAuth.token);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).process.currentState.code, 'THEORY_PASSED');

    const theoryAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const blockedTheorySchedule = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/schedule`, staffAuth.token, { scheduledFor: theoryAt });
    assert.equal(blockedTheorySchedule.status, 409);

    const theoryAttemptResponse = await post(base, '/api/admin/theory-exams', staffAuth.token, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: theoryAt,
      bookingSource: 'SCHOOL',
      protocol: 'PROCESS-OWNER-THEORY',
    });
    assert.equal(theoryAttemptResponse.status, 201);
    const theoryAttempt = (await theoryAttemptResponse.json() as any).attempt;
    assert.equal((await post(base, `/api/admin/theory-exams/${theoryAttempt.id}/attendance`, staffAuth.token, { attendanceStatus: 'PRESENT' })).status, 200);
    assert.equal((await post(base, `/api/admin/theory-exams/${theoryAttempt.id}/observed-result`, staffAuth.token, { result: 'APPROVED' })).status, 200);
    assert.equal((await post(base, `/api/admin/theory-exams/${theoryAttempt.id}/official-result`, staffAuth.token, { result: 'APPROVED' })).status, 200);

    const afterTheory = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, { headers: { Cookie: adminCookie } });
    assert.equal((await afterTheory.json() as any).process.currentState.code, 'PRACTICE_DONE');

    await pool.query(`INSERT INTO instructors(id, display_name) VALUES ($1, 'PROCESS-001 Instrutor')`, [instructorId]);
    await pool.query(`INSERT INTO instructor_categories(instructor_id, category) VALUES ($1, 'B')`, [instructorId]);
    await pool.query(`INSERT INTO vehicles(id, plate, label, category) VALUES ($1, $2, 'PROCESS-001 Veículo', 'B')`, [vehicleId, `P${Date.now().toString().slice(-6)}`]);
    await pool.query(
      `INSERT INTO lessons(id, enrollment_id, student_id, instructor_id, vehicle_id, category,
        starts_at, ends_at, status, resolved_at, created_by_staff_user_id)
       VALUES ($1,$2,$3,$4,$5,'B',$6,$7,'COMPLETED',$7,$8)`,
      [lessonId, receipt.enrollmentId, receipt.studentId, instructorId, vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000), new Date(Date.now() - 60 * 60 * 1000), bootstrap.staffUserId],
    );

    const practice = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, { headers: { Cookie: adminCookie } });
    const practiceProcess = (await practice.json() as any).process;
    assert.equal(practiceProcess.currentState.code, 'PRACTICE_DONE');
    assert.equal(practiceProcess.progress.completedLessons, 1);
    assert.equal(practiceProcess.progress.completedMinutes, 60);

    const practiceDone = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICE_DONE/achieve`, staffAuth.token);
    assert.equal(practiceDone.status, 200);
    assert.equal((await practiceDone.json() as any).process.currentState.code, 'PRACTICAL_EXAM_PASSED');

    const practicalBypass = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICAL_EXAM_PASSED/achieve`, staffAuth.token);
    assert.equal(practicalBypass.status, 409);
    assert.match((await practicalBypass.json() as any).error, /EXAMS-001/);

    const examStarts = new Date(Date.now() + 14 * 86400000);
    examStarts.setMinutes(0, 0, 0);
    const examEnds = new Date(examStarts.getTime() + 2 * 60 * 60 * 1000);
    const sessionResponse = await post(base, '/api/admin/exams', staffAuth.token, {
      category: 'B',
      locationLabel: 'PROCESS-001 Banca',
      startsAt: examStarts.toISOString(),
      endsAt: examEnds.toISOString(),
      instructorId,
      vehicleId,
      notes: 'owner-domain witness',
    });
    assert.equal(sessionResponse.status, 201);
    const session = (await sessionResponse.json() as any).session;

    const candidateAt = new Date(examStarts.getTime() + 30 * 60 * 1000).toISOString();
    const candidateResponse = await post(base, `/api/admin/exams/${session.id}/candidates`, staffAuth.token, {
      enrollmentId: receipt.enrollmentId,
      officialScheduledFor: candidateAt,
      bookingSource: 'SCHOOL',
      protocol: 'PROCESS-OWNER-PRACTICAL',
      feeStatus: 'UNKNOWN',
      ladvStatus: 'UNKNOWN',
    });
    assert.equal(candidateResponse.status, 201);
    const candidate = (await candidateResponse.json() as any).session.candidates[0];

    const blockedPracticalSchedule = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICAL_EXAM_PASSED/schedule`, staffAuth.token, { scheduledFor: candidateAt });
    assert.equal(blockedPracticalSchedule.status, 409);

    assert.equal((await post(base, `/api/admin/exams/${session.id}/candidates/${candidate.id}/attendance`, staffAuth.token, { attendanceStatus: 'PRESENT' })).status, 200);
    assert.equal((await post(base, `/api/admin/exams/${session.id}/candidates/${candidate.id}/observed-result`, staffAuth.token, { result: 'APPROVED' })).status, 200);
    const officialPractical = await post(base, `/api/admin/exams/${session.id}/candidates/${candidate.id}/official-result`, staffAuth.token, { result: 'APPROVED' });
    assert.equal(officialPractical.status, 200);

    const afterPractical = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, { headers: { Cookie: adminCookie } });
    assert.equal((await afterPractical.json() as any).process.currentState.code, 'LICENSE_AVAILABLE');

    const license = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/LICENSE_AVAILABLE/achieve`, staffAuth.token);
    assert.equal(license.status, 200);
    const complete = (await license.json() as any).process;
    assert.equal(complete.currentState.code, 'COMPLETE');
    assert.equal(complete.currentState.percent, 100);

    const revokeLicense = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/LICENSE_AVAILABLE/revoke`, staffAuth.token);
    assert.equal(revokeLicense.status, 200);
    assert.equal((await revokeLicense.json() as any).process.currentState.code, 'LICENSE_AVAILABLE');

    const blockedTheoryRevoke = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/revoke`, staffAuth.token);
    assert.equal(blockedTheoryRevoke.status, 409);
    const blockedPracticalRevoke = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICAL_EXAM_PASSED/revoke`, staffAuth.token);
    assert.equal(blockedPracticalRevoke.status, 409);

    const studentAfter = await fetch(`${base}/api/student/process`, { headers: { Cookie: studentCookie } });
    assert.equal(studentAfter.status, 200);
    const studentProcess = (await studentAfter.json() as any).processes[0];
    assert.equal(studentProcess.currentState.code, 'LICENSE_AVAILABLE');
    assert.equal(studentProcess.progress.completedMinutes, 60);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE actor_staff_user_id = $1 AND entity_id = $2 ORDER BY occurred_at`,
      [bootstrap.staffUserId, receipt.enrollmentId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'PROCESS_MILESTONE_SCHEDULED'));
    assert.ok(audit.rows.some((row) => row.action === 'PROCESS_MILESTONE_ACHIEVED'));
    assert.ok(audit.rows.some((row) => row.action === 'PROCESS_MILESTONE_REVOKED'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});