import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { projectAdminHome } from '../admin/today.js';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { achieveProcessMilestone } from '../process/resolver.js';
import {
  createScheduleInstructor,
  createScheduleLesson,
  createScheduleVehicle,
} from '../schedule/admin.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { createTheoryExamAttempt } from '../theory-exams/admin.js';
import { createAdminTodayApiHandler } from './admin-today.js';

const SUFFIX = randomUUID().slice(0, 8);
const USERNAME = `admin-home-${SUFFIX}`;
const PASSPHRASE = `Home-${randomUUID()}-Witness`;
const THEORY_CPF = `4${String(Math.floor(Math.random() * 1_000_000_0000)).padStart(10, '0')}`.slice(0, 11);
const PRACTICE_CPF = `5${String(Math.floor(Math.random() * 1_000_000_0000)).padStart(10, '0')}`.slice(0, 11);
const INSTRUCTOR = `ADMIN-HOME Instructor ${SUFFIX}`;
const PLATE = `HOM${SUFFIX.slice(0, 4)}`.toUpperCase();

function cookie(value: string): string {
  return `centro_admin_session=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>) {
  const students = await pool.query<{ id: string }>(
    'SELECT id FROM students WHERE cpf_normalized = ANY($1::text[])',
    [[THEORY_CPF, PRACTICE_CPF]],
  );
  const studentIds = students.rows.map((row) => row.id);
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [USERNAME]);
  const staffId = staff.rows[0]?.id ?? null;
  const instructors = await pool.query<{ id: string }>('SELECT id FROM instructors WHERE display_name = $1', [INSTRUCTOR]);
  const instructorId = instructors.rows[0]?.id ?? null;
  const vehicles = await pool.query<{ id: string }>('SELECT id FROM vehicles WHERE plate = $1', [PLATE]);
  const vehicleId = vehicles.rows[0]?.id ?? null;

  if (studentIds.length > 0) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = ANY($1::uuid[])', [studentIds]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    if (enrollmentIds.length > 0) {
      await pool.query('DELETE FROM theory_exam_attempts WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM practical_exam_candidates WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM lessons WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_intake_observations WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id = ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query(
      `DELETE FROM audit_events
       WHERE actor_student_id = ANY($1::uuid[])
          OR entity_id = ANY($1::uuid[])
          OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = ANY($1::uuid[]))`,
      [studentIds],
    );
    await pool.query('DELETE FROM student_guides WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM sessions WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }

  if (instructorId) {
    await pool.query('DELETE FROM audit_events WHERE entity_id = $1', [instructorId]);
    await pool.query('DELETE FROM instructor_categories WHERE instructor_id = $1', [instructorId]);
    await pool.query('DELETE FROM instructors WHERE id = $1', [instructorId]);
  }
  if (vehicleId) {
    await pool.query('DELETE FROM audit_events WHERE entity_id = $1', [vehicleId]);
    await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
  }
  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

test('ADMIN-HOME-002 derives global actions and reconciles them into scheduled events through owner domains', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  try {
    const admin = await bootstrapFirstAdmin(pool, {
      username: USERNAME,
      displayName: 'ADMIN HOME Witness',
      password: PASSPHRASE,
    });
    assert.equal(admin.created, true);
    assert.ok(admin.staffUserId);

    const theory = await materializeEnrollment(pool, {
      fullName: `Theory Home ${SUFFIX}`,
      phone: '11911111111',
      email: `theory-home-${SUFFIX}@example.test`,
      cpf: THEORY_CPF,
      birthDate: '1998-05-10',
      identityDocument: { type: 'RG', number: `TH-${SUFFIX}`, uf: 'SP' },
      intake: { situation: 'PROCESS_STARTED' },
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: admin.staffUserId,
    });
    await achieveProcessMilestone(pool, {
      enrollmentId: theory.enrollmentId,
      code: 'REGISTRATION_DONE',
      actorStaffUserId: admin.staffUserId,
    });
    await achieveProcessMilestone(pool, {
      enrollmentId: theory.enrollmentId,
      code: 'HEALTH_DONE',
      actorStaffUserId: admin.staffUserId,
    });

    const practice = await materializeEnrollment(pool, {
      fullName: `Practice Home ${SUFFIX}`,
      phone: '11922222222',
      email: `practice-home-${SUFFIX}@example.test`,
      cpf: PRACTICE_CPF,
      birthDate: '1997-03-11',
      identityDocument: { type: 'RG', number: `PR-${SUFFIX}`, uf: 'SP' },
      intake: { situation: 'THEORY_EXAM_PASSED', renach: `REN-${SUFFIX}` },
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: admin.staffUserId,
    });

    const before = await projectAdminHome(pool);
    assert.equal(before.version, 'ADMIN_HOME_V2');
    const theoryAction = before.attention.actionRequired.find((item) => item.studentId === theory.studentId);
    assert.equal(theoryAction?.action.code, 'SCHEDULE_THEORY_EXAM');
    assert.equal(theoryAction?.action.primaryCommand?.kind, 'SCHEDULE_THEORY_EXAM');
    const practiceAction = before.attention.actionRequired.find((item) => item.studentId === practice.studentId);
    assert.equal(practiceAction?.action.code, 'SCHEDULE_FIRST_LESSON');
    assert.equal(practiceAction?.action.primaryCommand?.kind, 'SCHEDULE_LESSON');
    assert.ok(before.pendingFirstAccess.some((item) => item.studentId === theory.studentId));

    const theoryStartsAt = new Date(Date.now() + 2 * 60 * 60_000);
    const attempt = await createTheoryExamAttempt(pool, {
      enrollmentId: theory.enrollmentId,
      scheduledFor: theoryStartsAt,
      bookingSource: 'SCHOOL',
      protocol: `HOME-${SUFFIX}`,
      actorStaffUserId: admin.staffUserId,
    });

    const instructor = await createScheduleInstructor(pool, {
      displayName: INSTRUCTOR,
      categories: ['B'],
      actorStaffUserId: admin.staffUserId,
    });
    const vehicle = await createScheduleVehicle(pool, {
      plate: PLATE,
      label: `Home Vehicle ${SUFFIX}`,
      category: 'B',
      actorStaffUserId: admin.staffUserId,
    });
    const lessonStartsAt = new Date(Date.now() + 60 * 60_000);
    lessonStartsAt.setUTCSeconds(0, 0);
    if (lessonStartsAt.getUTCMinutes() < 30) {
      lessonStartsAt.setUTCMinutes(30, 0, 0);
    } else {
      lessonStartsAt.setUTCHours(lessonStartsAt.getUTCHours() + 1, 0, 0, 0);
    }
    const lesson = await createScheduleLesson(pool, {
      enrollmentId: practice.enrollmentId,
      studentId: practice.studentId,
      instructorId: instructor.id,
      vehicleId: vehicle.id,
      category: 'B',
      startsAt: lessonStartsAt,
      endsAt: new Date(lessonStartsAt.getTime() + 60 * 60_000),
      notes: 'ADMIN-HOME-002 witness',
      actorStaffUserId: admin.staffUserId,
    });

    const after = await projectAdminHome(pool);
    assert.ok(!after.attention.actionRequired.some((item) => item.studentId === theory.studentId));
    assert.ok(!after.attention.actionRequired.some((item) => item.studentId === practice.studentId));
    assert.ok(after.upcoming.some((event) => event.kind === 'THEORY_EXAM' && event.id === attempt.id));
    assert.ok(after.upcoming.some((event) => event.kind === 'LESSON' && event.id === lesson.id));
    assert.ok(after.summary.upcoming24h >= 2);

    const auth = await authenticateStaff(pool, USERNAME, PASSPHRASE);
    assert.ok(auth);
    const handler = createAdminTodayApiHandler(pool);
    const server = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    try {
      assert.equal((await fetch(`${base}/api/admin/home`)).status, 401);
      const response = await fetch(`${base}/api/admin/home`, { headers: { Cookie: cookie(auth.token) } });
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      assert.equal(body.version, 'ADMIN_HOME_V2');
      assert.equal(body.timezone, 'America/Sao_Paulo');
      assert.ok(body.upcoming.some((event: any) => event.id === attempt.id));
      assert.ok(body.upcoming.some((event: any) => event.id === lesson.id));

      const alias = await fetch(`${base}/api/admin/today`, { headers: { Cookie: cookie(auth.token) } });
      assert.equal(alias.status, 200);
      assert.equal((await alias.json() as any).version, 'ADMIN_HOME_V2');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await cleanup(pool);
    await pool.end();
  }
});
