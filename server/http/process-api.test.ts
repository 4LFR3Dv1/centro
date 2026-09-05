import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { activateStudentAccessQr } from '../student/access.js';
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

test('PROCESS-001 derives a linear first-license process, projects Lesson evidence and isolates Student authority', async () => {
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
    notes: 'PROCESS-001 witness',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.equal(receipt.activationRequired, true);

  const staffAuth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
  assert.ok(staffAuth);
  const studentActivation = await activateStudentAccessQr(pool, {
    publicToken: receipt.accessQr.publicToken,
    password: `Process-${randomUUID()}-Student`,
  });

  const handler = createProcessApiHandler(pool, { publicOrigin: ORIGIN });
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
  const studentCookie = cookie('centro_student_session', studentActivation.token);

  const instructorId = randomUUID();
  const vehicleId = randomUUID();
  const lessonId = randomUUID();

  try {
    const anonymous = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`);
    assert.equal(anonymous.status, 401);

    const initial = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { process: any };
    assert.equal(initialBody.process.currentState.code, 'REGISTRATION_DONE');
    assert.equal(initialBody.process.currentState.percent, 14);
    assert.equal(initialBody.process.milestones[0].code, 'PROCESS_STARTED');
    assert.equal(initialBody.process.milestones[0].achieved, true);

    const skip = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/achieve`, staffAuth.token);
    assert.equal(skip.status, 409);

    const registration = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/REGISTRATION_DONE/achieve`, staffAuth.token);
    assert.equal(registration.status, 200);
    assert.equal((await registration.json() as any).process.currentState.code, 'HEALTH_DONE');

    const health = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/HEALTH_DONE/achieve`, staffAuth.token);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).process.currentState.code, 'THEORY_PASSED');

    const theoryAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const theorySchedule = await post(
      base,
      `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/schedule`,
      staffAuth.token,
      { scheduledFor: theoryAt },
    );
    assert.equal(theorySchedule.status, 200);
    const theoryScheduleBody = await theorySchedule.json() as { process: any };
    assert.equal(theoryScheduleBody.process.nextAction.code, 'ATTEND_THEORY_EXAM');
    assert.equal(theoryScheduleBody.process.milestones.find((m: any) => m.code === 'THEORY_PASSED').scheduledFor, theoryAt);

    const studentTheory = await fetch(`${base}/api/student/process`, { headers: { Cookie: studentCookie } });
    assert.equal(studentTheory.status, 200);
    const studentTheoryBody = await studentTheory.json() as { processes: any[] };
    assert.equal(studentTheoryBody.processes.length, 1);
    assert.equal(studentTheoryBody.processes[0].currentState.code, 'THEORY_PASSED');

    const theory = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/THEORY_PASSED/achieve`, staffAuth.token);
    assert.equal(theory.status, 200);
    assert.equal((await theory.json() as any).process.currentState.code, 'PRACTICE_DONE');

    await pool.query(`INSERT INTO instructors(id, display_name) VALUES ($1, 'PROCESS-001 Instrutor')`, [instructorId]);
    await pool.query(`INSERT INTO instructor_categories(instructor_id, category) VALUES ($1, 'B')`, [instructorId]);
    await pool.query(
      `INSERT INTO vehicles(id, plate, label, category) VALUES ($1, $2, 'PROCESS-001 Veículo', 'B')`,
      [vehicleId, `P${Date.now().toString().slice(-6)}`],
    );
    await pool.query(
      `INSERT INTO lessons(
         id, enrollment_id, student_id, instructor_id, vehicle_id, category,
         starts_at, ends_at, status, resolved_at, created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,'COMPLETED',$7,$8)`,
      [
        lessonId,
        receipt.enrollmentId,
        receipt.studentId,
        instructorId,
        vehicleId,
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        new Date(Date.now() - 60 * 60 * 1000),
        bootstrap.staffUserId,
      ],
    );

    const practice = await fetch(`${base}/api/admin/process/enrollments/${receipt.enrollmentId}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(practice.status, 200);
    const practiceBody = await practice.json() as { process: any };
    assert.equal(practiceBody.process.currentState.code, 'PRACTICE_DONE');
    assert.equal(practiceBody.process.progress.completedLessons, 1);
    assert.equal(practiceBody.process.progress.completedMinutes, 60);
    assert.equal(practiceBody.process.nextAction.code, 'CONTINUE_PRACTICE');

    const practiceDone = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICE_DONE/achieve`, staffAuth.token);
    assert.equal(practiceDone.status, 200);
    assert.equal((await practiceDone.json() as any).process.currentState.code, 'PRACTICAL_EXAM_PASSED');

    const examAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const examSchedule = await post(
      base,
      `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICAL_EXAM_PASSED/schedule`,
      staffAuth.token,
      { scheduledFor: examAt },
    );
    assert.equal(examSchedule.status, 200);
    assert.equal((await examSchedule.json() as any).process.nextAction.code, 'ATTEND_PRACTICAL_EXAM');

    const examPassed = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/PRACTICAL_EXAM_PASSED/achieve`, staffAuth.token);
    assert.equal(examPassed.status, 200);
    assert.equal((await examPassed.json() as any).process.currentState.code, 'LICENSE_AVAILABLE');

    const license = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/LICENSE_AVAILABLE/achieve`, staffAuth.token);
    assert.equal(license.status, 200);
    const complete = await license.json() as { process: any };
    assert.equal(complete.process.currentState.code, 'COMPLETE');
    assert.equal(complete.process.currentState.percent, 100);
    assert.equal(complete.process.nextAction, null);

    const revoke = await post(base, `/api/admin/process/enrollments/${receipt.enrollmentId}/milestones/LICENSE_AVAILABLE/revoke`, staffAuth.token);
    assert.equal(revoke.status, 200);
    assert.equal((await revoke.json() as any).process.currentState.code, 'LICENSE_AVAILABLE');

    const studentAfter = await fetch(`${base}/api/student/process`, { headers: { Cookie: studentCookie } });
    assert.equal(studentAfter.status, 200);
    const studentAfterBody = await studentAfter.json() as { processes: any[] };
    assert.equal(studentAfterBody.processes[0].currentState.code, 'LICENSE_AVAILABLE');
    assert.equal(studentAfterBody.processes[0].progress.completedMinutes, 60);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE actor_staff_user_id = $1 AND entity_id = $2
       ORDER BY occurred_at`,
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
