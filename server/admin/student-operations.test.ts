import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { createDatabasePool } from '../db/pool.js';
import {
  createScheduleInstructor,
  createScheduleLesson,
  createScheduleVehicle,
} from '../schedule/admin.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { getCurrentStudentAccessQr, resolveStudentAccessQr } from '../student/access.js';
import { resolveStudentOperationalContext } from './student-operations.js';

const SUFFIX = randomUUID().slice(0, 8);
const ADMIN_USER = `process-ops-${SUFFIX}`;
const ADMIN_PASSWORD = `Process-Ops-${randomUUID()}-Test`;
const TEST_CPF = `8${String(Math.floor(Math.random() * 1_000_000_0000)).padStart(10, '0')}`.slice(0, 11);
const TEST_INSTRUCTOR = `Instrutor PROCESS-OPS ${SUFFIX}`;
const TEST_PLATE = `OPS${SUFFIX.slice(0, 4)}`.toUpperCase();

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE cpf_normalized = $1', [TEST_CPF]);
  const studentId = students.rows[0]?.id ?? null;
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const instructors = await pool.query<{ id: string }>('SELECT id FROM instructors WHERE display_name = $1', [TEST_INSTRUCTOR]);
  const instructorId = instructors.rows[0]?.id ?? null;
  const vehicles = await pool.query<{ id: string }>('SELECT id FROM vehicles WHERE plate = $1', [TEST_PLATE]);
  const vehicleId = vehicles.rows[0]?.id ?? null;

  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
  }

  if (studentId) {
    await pool.query(
      `DELETE FROM audit_events
       WHERE actor_student_id = $1
          OR entity_id = $1
          OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)
          OR entity_id IN (SELECT id FROM lessons WHERE student_id = $1)
          OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)`,
      [studentId],
    );
    await pool.query('DELETE FROM lessons WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollment_intake_observations WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM student_guides WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
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
  if (staffId) await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
}

test('PROCESS-OPS-001 resolves QR identity into school action and recomputes after scheduling', async () => {
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
    assert.match(before.primaryAction.href ?? '', new RegExp(`enrollmentId=${receipt.enrollmentId}`));

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

    await createScheduleLesson(pool, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor.id,
      vehicleId: vehicle.id,
      category: 'B',
      startsAt,
      endsAt,
      notes: 'PROCESS-OPS-001 witness',
      actorStaffUserId: bootstrap.staffUserId,
    });

    const after = await resolveStudentOperationalContext(pool, resolvedQr.studentId);
    assert.ok(after.primaryAction);
    assert.equal(after.primaryAction.enrollmentId, receipt.enrollmentId);
    assert.equal(after.primaryAction.code, 'LESSON_ALREADY_SCHEDULED');
    assert.equal(after.primaryAction.severity, 'SCHEDULED');
    assert.equal(after.primaryAction.href, '/admin/agenda');
  } finally {
    await cleanup(pool);
    await pool.end();
  }
});
