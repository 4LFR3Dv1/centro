import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { achieveProcessMilestone } from '../process/resolver.js';
import {
  createScheduleInstructor,
  createScheduleLesson,
  createScheduleVehicle,
  resolveLesson,
} from '../schedule/admin.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { getCurrentStudentAccessQr, resolveStudentAccessQr } from '../student/access.js';
import {
  createTheoryExamAttempt,
  reconcileTheoryExamOfficialResult,
  recordTheoryExamAttendance,
  recordTheoryExamObservedResult,
} from '../theory-exams/admin.js';
import { resolveStudentOperationalContext } from './student-operations.js';

const SUFFIX = randomUUID().slice(0, 8);
const ADMIN_USER = `process-ops-${SUFFIX}`;
const ADMIN_PASSWORD = `Process-Ops-${randomUUID()}-Test`;
const TEST_CPF = `8${String(Math.floor(Math.random() * 1_000_000_0000)).padStart(10, '0')}`.slice(0, 11);
const THEORY_CPF = `6${String(Math.floor(Math.random() * 1_000_000_0000)).padStart(10, '0')}`.slice(0, 11);
const TEST_INSTRUCTOR = `Instrutor PROCESS-OPS ${SUFFIX}`;
const TEST_PLATE = `OPS${SUFFIX.slice(0, 4)}`.toUpperCase();

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const students = await pool.query<{ id: string }>(
    'SELECT id FROM students WHERE cpf_normalized = ANY($1::text[])',
    [[TEST_CPF, THEORY_CPF]],
  );
  const studentIds = students.rows.map((row) => row.id);
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const instructors = await pool.query<{ id: string }>('SELECT id FROM instructors WHERE display_name = $1', [TEST_INSTRUCTOR]);
  const instructorId = instructors.rows[0]?.id ?? null;
  const vehicles = await pool.query<{ id: string }>('SELECT id FROM vehicles WHERE plate = $1', [TEST_PLATE]);
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

test('PROCESS-OPS-002 resolves QR identity into executable Lesson commands and recomputes after scheduling', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  try {
    const bootstrap = await bootstrapFirstAdmin(pool, {
      username: ADMIN_USER,
      displayName: 'PROCESS OPS Witness',
      password: ADMIN_PASSWORD,
    });
    assert.equal(bootstrap.created, true);
    assert.ok(bootstrap.staffUserId);

    const receipt = await materializeEnrollment(pool, {
      fullName: `Aluno PROCESS OPS ${SUFFIX}`,
      phone: '11999999999',
      email: `process-ops-${SUFFIX}@example.test`,
      cpf: TEST_CPF,
      birthDate: '1997-04-12',
      identityDocument: {
        type: 'RG',
        number: `RG-${SUFFIX}`,
        uf: 'SP',
      },
      intake: {
        situation: 'THEORY_EXAM_PASSED',
        renach: `RENACH-${SUFFIX}`,
      },
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const qr = await getCurrentStudentAccessQr(pool, receipt.studentId);
    assert.ok(qr, 'enrollment materialization must preserve the Student QR primitive');
    const resolvedQr = await resolveStudentAccessQr(pool, qr.publicToken);
    assert.ok(resolvedQr);
    assert.equal(resolvedQr.studentId, receipt.studentId);

    const before = await resolveStudentOperationalContext(pool, resolvedQr.studentId);
    assert.ok(before.primaryAction);
    assert.equal(before.primaryAction.enrollmentId, receipt.enrollmentId);
    assert.equal(before.primaryAction.processStateCode, 'PRACTICE_DONE');
    assert.equal(before.primaryAction.code, 'SCHEDULE_FIRST_LESSON');
    assert.equal(before.primaryAction.severity, 'ACTION_REQUIRED');
    assert.equal(before.primaryAction.primaryCommand?.kind, 'SCHEDULE_LESSON');
    assert.ok(before.primaryAction.secondaryCommands.some((command) => command.kind === 'ACHIEVE_MILESTONE' && command.milestoneCode === 'PRACTICE_DONE'));

    const instructor = await createScheduleInstructor(pool, {
      displayName: TEST_INSTRUCTOR,
      categories: ['B'],
      actorStaffUserId: bootstrap.staffUserId,
    });
    const vehicle = await createScheduleVehicle(pool, {
      plate: TEST_PLATE,
      label: `Veículo PROCESS-OPS ${SUFFIX}`,
      category: 'B',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    startsAt.setUTCMinutes(startsAt.getUTCMinutes() < 30 ? 30 : 0, 0, 0);
    if (startsAt.getUTCMinutes() === 0) startsAt.setUTCHours(startsAt.getUTCHours() + 1);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

    const firstLesson = await createScheduleLesson(pool, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor.id,
      vehicleId: vehicle.id,
      category: 'B',
      startsAt,
      endsAt,
      notes: 'PROCESS-OPS-002 witness',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const after = await resolveStudentOperationalContext(pool, resolvedQr.studentId);
    assert.ok(after.primaryAction);
    assert.equal(after.primaryAction.enrollmentId, receipt.enrollmentId);
    assert.equal(after.primaryAction.code, 'LESSON_ALREADY_SCHEDULED');
    assert.equal(after.primaryAction.severity, 'SCHEDULED');
    assert.equal(after.primaryAction.primaryCommand?.kind, 'OPEN_URL');
    assert.equal(after.primaryAction.href, '/admin/agenda');
    assert.ok(after.primaryAction.secondaryCommands.some((command) => command.kind === 'ACHIEVE_MILESTONE' && command.milestoneCode === 'PRACTICE_DONE'));

    await resolveLesson(pool, firstLesson.id, {
      status: 'NO_SHOW',
      actorStaffUserId: bootstrap.staffUserId,
    });
    const afterNoShow = await resolveStudentOperationalContext(pool, resolvedQr.studentId);
    assert.equal(afterNoShow.primaryAction?.code, 'LESSON_NO_SHOW_RECOVERY');
    assert.equal(afterNoShow.primaryAction?.primaryCommand?.kind, 'SCHEDULE_LESSON');
    assert.equal(afterNoShow.primaryAction?.primaryCommand?.label, 'Agendar nova aula');

    const secondStartsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
    const secondLesson = await createScheduleLesson(pool, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor.id,
      vehicleId: vehicle.id,
      category: 'B',
      startsAt: secondStartsAt,
      endsAt: new Date(secondStartsAt.getTime() + 60 * 60 * 1000),
      actorStaffUserId: bootstrap.staffUserId,
    });
    await resolveLesson(pool, secondLesson.id, {
      status: 'CANCELLED',
      actorStaffUserId: bootstrap.staffUserId,
    });
    const afterCancellation = await resolveStudentOperationalContext(pool, resolvedQr.studentId);
    assert.equal(afterCancellation.primaryAction?.code, 'LESSON_CANCELLED_RECOVERY');
    assert.equal(afterCancellation.primaryAction?.primaryCommand?.kind, 'SCHEDULE_LESSON');
  } finally {
    await cleanup(pool);
    await pool.end();
  }
});

test('PROCESS-OPS-002 derives theory commands from the THEORY-EXAM-001 attempt lifecycle', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  try {
    const existingStaff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
    const bootstrap = existingStaff.rows[0]?.id
      ? { created: false, staffUserId: existingStaff.rows[0].id }
      : await bootstrapFirstAdmin(pool, {
          username: ADMIN_USER,
          displayName: 'PROCESS OPS Witness',
          password: ADMIN_PASSWORD,
        });
    assert.ok(bootstrap.staffUserId);

    const receipt = await materializeEnrollment(pool, {
      fullName: `Aluno THEORY OPS ${SUFFIX}`,
      phone: '11888888888',
      email: `theory-ops-${SUFFIX}@example.test`,
      cpf: THEORY_CPF,
      birthDate: '1998-08-08',
      identityDocument: { type: 'RG', number: `THEORY-${SUFFIX}`, uf: 'SP' },
      intake: { situation: 'PROCESS_STARTED' },
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: bootstrap.staffUserId,
    });

    await achieveProcessMilestone(pool, {
      enrollmentId: receipt.enrollmentId,
      code: 'REGISTRATION_DONE',
      actorStaffUserId: bootstrap.staffUserId,
    });
    await achieveProcessMilestone(pool, {
      enrollmentId: receipt.enrollmentId,
      code: 'HEALTH_DONE',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const needsSchedule = await resolveStudentOperationalContext(pool, receipt.studentId);
    assert.equal(needsSchedule.primaryAction?.code, 'SCHEDULE_THEORY_EXAM');
    assert.equal(needsSchedule.primaryAction?.primaryCommand?.kind, 'SCHEDULE_THEORY_EXAM');

    const attempt = await createTheoryExamAttempt(pool, {
      enrollmentId: receipt.enrollmentId,
      scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      bookingSource: 'SCHOOL',
      protocol: `OPS-${SUFFIX}`,
      actorStaffUserId: bootstrap.staffUserId,
    });

    const scheduled = await resolveStudentOperationalContext(pool, receipt.studentId);
    assert.equal(scheduled.primaryAction?.code, 'THEORY_EXAM_SCHEDULED');
    assert.equal(scheduled.primaryAction?.primaryCommand?.kind, 'MANAGE_THEORY_EXAM');

    await recordTheoryExamAttendance(pool, {
      attemptId: attempt.id,
      attendanceStatus: 'PRESENT',
      actorStaffUserId: bootstrap.staffUserId,
    });
    const resultRequired = await resolveStudentOperationalContext(pool, receipt.studentId);
    assert.equal(resultRequired.primaryAction?.code, 'THEORY_EXAM_RESULT_REQUIRED');

    await recordTheoryExamObservedResult(pool, {
      attemptId: attempt.id,
      result: 'FAILED',
      actorStaffUserId: bootstrap.staffUserId,
    });
    const reconciliationRequired = await resolveStudentOperationalContext(pool, receipt.studentId);
    assert.equal(reconciliationRequired.primaryAction?.code, 'THEORY_EXAM_RECONCILIATION_REQUIRED');

    await reconcileTheoryExamOfficialResult(pool, {
      attemptId: attempt.id,
      result: 'FAILED',
      actorStaffUserId: bootstrap.staffUserId,
    });
    const retry = await resolveStudentOperationalContext(pool, receipt.studentId);
    assert.equal(retry.primaryAction?.code, 'SCHEDULE_THEORY_EXAM');
    assert.equal(retry.primaryAction?.primaryCommand?.kind, 'SCHEDULE_THEORY_EXAM');
  } finally {
    await cleanup(pool);
    await pool.end();
  }
});
