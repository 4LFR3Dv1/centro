import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { hashPassword } from '../ops/credentials.js';
import { createScheduleLesson } from '../schedule/admin.js';
import { authenticateStaff } from '../staff/auth.js';
import { createAdminExamsApiHandler } from './admin-exams.js';

const ORIGIN = 'https://centro-exams.test';
const ADMIN_USER = `exams-admin-${randomUUID()}`;
const ADMIN_PASSWORD = `Exams-${randomUUID()}-Admin`;
const TEST_DOCUMENT = `8${String(Date.now()).slice(-10)}`;

async function cleanup(pool: ReturnType<typeof createDatabasePool>, staffId: string | null, studentId: string | null): Promise<void> {
  if (staffId) {
    await pool.query('DELETE FROM practical_exam_candidates WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM practical_exam_sessions WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM lessons WHERE created_by_staff_user_id = $1', [staffId]);
  }

  if (studentId) {
    await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = $1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM student_credentials WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  await pool.query(`DELETE FROM instructor_categories WHERE instructor_id IN (SELECT id FROM instructors WHERE display_name = 'EXAMS Test Instrutor')`);
  await pool.query(`DELETE FROM instructors WHERE display_name = 'EXAMS Test Instrutor'`);
  await pool.query(`DELETE FROM vehicles WHERE label = 'EXAMS Test Veículo'`);

  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_credentials WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

async function postJson(base: string, path: string, cookie: string, body: unknown, origin = ORIGIN): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

test('EXAMS-001 materializes practical exam rosters with conflicts, ordered candidates, attendance and official result reconciliation', async () => {
  const pool = createDatabasePool();
  let staffId: string | null = null;
  let studentId: string | null = null;

  try {
    staffId = randomUUID();
    await pool.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, 'EXAMS Test Admin', 'ADMIN')`,
      [staffId, ADMIN_USER],
    );
    await pool.query(
      'INSERT INTO staff_credentials(staff_user_id, password_hash) VALUES ($1, $2)',
      [staffId, await hashPassword(ADMIN_PASSWORD)],
    );
    const auth = await authenticateStaff(pool, ADMIN_USER, ADMIN_PASSWORD);
    assert.ok(auth);
    const cookie = `centro_admin_session=${encodeURIComponent(auth.token)}`;

    const receipt = await materializeEnrollment(pool, {
      fullName: 'Aluno EXAMS Test',
      phone: '11966667777',
      email: 'exams@example.test',
      document: TEST_DOCUMENT,
      birthDate: '2000-01-01',
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      notes: 'EXAMS-001 witness',
      actorStaffUserId: staffId,
    });
    studentId = receipt.studentId;

    for (const code of ['REGISTRATION_DONE', 'HEALTH_DONE', 'THEORY_PASSED', 'PRACTICE_DONE']) {
      await pool.query(
        `INSERT INTO enrollment_milestones(
           id, enrollment_id, code, achieved_at, achieved_by_staff_user_id, updated_by_staff_user_id
         ) VALUES ($1, $2, $3, now(), $4, $4)`,
        [randomUUID(), receipt.enrollmentId, code, staffId],
      );
    }

    const instructorId = randomUUID();
    await pool.query('INSERT INTO instructors(id, display_name) VALUES ($1, $2)', [instructorId, 'EXAMS Test Instrutor']);
    await pool.query('INSERT INTO instructor_categories(instructor_id, category) VALUES ($1, $2)', [instructorId, 'B']);
    const vehicleId = randomUUID();
    await pool.query(
      `INSERT INTO vehicles(id, plate, label, category)
       VALUES ($1, $2, 'EXAMS Test Veículo', 'B')`,
      [vehicleId, `EXM${String(Date.now()).slice(-4)}B`],
    );

    const handler = createAdminExamsApiHandler(pool, { publicOrigin: ORIGIN });
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
      const anonymous = await fetch(`${base}/api/admin/exams/options`);
      assert.equal(anonymous.status, 401);

      const wrongOrigin = await postJson(base, '/api/admin/exams', cookie, {
        category: 'B',
        locationLabel: 'EXAMS Test Pátio',
        startsAt: '2026-10-10T11:00:00.000Z',
        endsAt: '2026-10-10T15:00:00.000Z',
        instructorId,
        vehicleId,
      }, 'https://invalid-origin.test');
      assert.equal(wrongOrigin.status, 403);

      const create = await postJson(base, '/api/admin/exams', cookie, {
        category: 'B',
        locationLabel: 'EXAMS Test Pátio',
        startsAt: '2026-10-10T11:00:00.000Z',
        endsAt: '2026-10-10T15:00:00.000Z',
        instructorId,
        vehicleId,
        notes: 'Lista operacional EXAMS-001',
      });
      assert.equal(create.status, 201);
      const created = await create.json() as { session: { id: string; candidateCount: number; status: string } };
      const examSessionId = created.session.id;
      assert.equal(created.session.candidateCount, 0);
      assert.equal(created.session.status, 'PLANNED');

      const overlapping = await postJson(base, '/api/admin/exams', cookie, {
        category: 'B',
        locationLabel: 'EXAMS Test Segundo Pátio',
        startsAt: '2026-10-10T12:00:00.000Z',
        endsAt: '2026-10-10T14:00:00.000Z',
        instructorId,
        vehicleId,
      });
      assert.equal(overlapping.status, 409);

      await assert.rejects(
        () => createScheduleLesson(pool, {
          enrollmentId: receipt.enrollmentId,
          studentId: receipt.studentId,
          instructorId,
          vehicleId,
          category: 'B',
          startsAt: '2026-10-10T12:00:00.000Z',
          endsAt: '2026-10-10T13:00:00.000Z',
          actorStaffUserId: staffId!,
        }),
        (error: unknown) => {
          const candidate = error as { constraint?: string };
          return candidate.constraint === 'lessons_instructor_practical_exam_conflict'
            || candidate.constraint === 'lessons_vehicle_practical_exam_conflict';
        },
      );

      const optionsResponse = await fetch(`${base}/api/admin/exams/options`, { headers: { Cookie: cookie } });
      assert.equal(optionsResponse.status, 200);
      const options = await optionsResponse.json() as {
        instructors: Array<{ id: string }>;
        vehicles: Array<{ id: string }>;
        enrollments: Array<{ id: string }>;
      };
      assert.ok(options.instructors.some((item) => item.id === instructorId));
      assert.ok(options.vehicles.some((item) => item.id === vehicleId));
      assert.ok(options.enrollments.some((item) => item.id === receipt.enrollmentId));

      const add = await postJson(base, `/api/admin/exams/${examSessionId}/candidates`, cookie, {
        enrollmentId: receipt.enrollmentId,
        officialScheduledFor: '2026-10-10T12:00:00.000Z',
        bookingSource: 'SCHOOL',
        protocol: 'PROTO-EXAMS-001',
        renach: 'RENACH-EXAMS-001',
        feeStatus: 'PAID',
        ladvStatus: 'READY',
      });
      assert.equal(add.status, 201);
      const added = await add.json() as { session: { candidates: Array<{ id: string; studentPublicId: string; officialScheduledFor: string }> } };
      assert.equal(added.session.candidates.length, 1);
      assert.equal(added.session.candidates[0].studentPublicId, receipt.studentPublicId);
      assert.equal(added.session.candidates[0].officialScheduledFor, '2026-10-10T12:00:00.000Z');
      const candidateId = added.session.candidates[0].id;

      const duplicate = await postJson(base, `/api/admin/exams/${examSessionId}/candidates`, cookie, {
        enrollmentId: receipt.enrollmentId,
        officialScheduledFor: '2026-10-10T12:30:00.000Z',
        bookingSource: 'SCHOOL',
      });
      assert.equal(duplicate.status, 409);

      const optionsAfterAdd = await fetch(`${base}/api/admin/exams/options`, { headers: { Cookie: cookie } });
      const optionsAfterAddBody = await optionsAfterAdd.json() as { enrollments: Array<{ id: string }> };
      assert.equal(optionsAfterAddBody.enrollments.some((item) => item.id === receipt.enrollmentId), false);

      const detailResponse = await fetch(`${base}/api/admin/exams/${examSessionId}`, { headers: { Cookie: cookie } });
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json() as { session: { candidates: Array<{ protocol: string; renach: string; documentMasked: string }> } };
      assert.equal(detail.session.candidates[0].protocol, 'PROTO-EXAMS-001');
      assert.equal(detail.session.candidates[0].renach, 'RENACH-EXAMS-001');
      assert.ok(detail.session.candidates[0].documentMasked.endsWith(TEST_DOCUMENT.slice(-4)));

      const attendance = await postJson(base, `/api/admin/exams/${examSessionId}/candidates/${candidateId}/attendance`, cookie, {
        attendanceStatus: 'PRESENT',
      });
      assert.equal(attendance.status, 200);

      const observed = await postJson(base, `/api/admin/exams/${examSessionId}/candidates/${candidateId}/observed-result`, cookie, {
        result: 'APPROVED',
      });
      assert.equal(observed.status, 200);

      const official = await postJson(base, `/api/admin/exams/${examSessionId}/candidates/${candidateId}/official-result`, cookie, {
        result: 'APPROVED',
      });
      assert.equal(official.status, 200);
      const officialBody = await official.json() as { session: { approvedCount: number; pendingCount: number } };
      assert.equal(officialBody.session.approvedCount, 1);
      assert.equal(officialBody.session.pendingCount, 0);

      const milestone = await pool.query<{ achieved_at: Date | null; scheduled_for: Date | null }>(
        `SELECT achieved_at, scheduled_for
         FROM enrollment_milestones
         WHERE enrollment_id = $1 AND code = 'PRACTICAL_EXAM_PASSED'`,
        [receipt.enrollmentId],
      );
      assert.ok(milestone.rows[0]?.achieved_at);
      assert.equal(milestone.rows[0]?.scheduled_for?.toISOString(), '2026-10-10T12:00:00.000Z');

      const confirm = await postJson(base, `/api/admin/exams/${examSessionId}/status`, cookie, { status: 'CONFIRMED' });
      assert.equal(confirm.status, 200);
      const close = await postJson(base, `/api/admin/exams/${examSessionId}/status`, cookie, { status: 'CLOSED' });
      assert.equal(close.status, 200);

      const audit = await pool.query<{ action: string }>(
        `SELECT action
         FROM audit_events
         WHERE actor_staff_user_id = $1
           AND action IN (
             'EXAM_SESSION_CREATED',
             'EXAM_CANDIDATE_ADDED',
             'EXAM_ATTENDANCE_RECORDED',
             'EXAM_RESULT_OBSERVED',
             'EXAM_RESULT_RECONCILED',
             'PROCESS_MILESTONE_ACHIEVED',
             'EXAM_SESSION_STATUS_CHANGED'
           )`,
        [staffId],
      );
      const actions = new Set(audit.rows.map((row) => row.action));
      for (const expected of [
        'EXAM_SESSION_CREATED',
        'EXAM_CANDIDATE_ADDED',
        'EXAM_ATTENDANCE_RECORDED',
        'EXAM_RESULT_OBSERVED',
        'EXAM_RESULT_RECONCILED',
        'PROCESS_MILESTONE_ACHIEVED',
        'EXAM_SESSION_STATUS_CHANGED',
      ]) assert.equal(actions.has(expected), true, `${expected} must be audited`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await cleanup(pool, staffId, studentId);
    await pool.end();
  }
});
