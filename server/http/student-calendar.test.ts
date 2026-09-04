import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import {
  createScheduleInstructor,
  createScheduleLesson,
  createScheduleVehicle,
  resolveLesson,
} from '../schedule/admin.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { createStudentApiHandler } from './student-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'student-calendar-admin-test';
const ADMIN_PASSWORD = `Calendar-${randomUUID()}-Admin`;
const DOCUMENT_ONE = '6'.repeat(11);
const DOCUMENT_TWO = '5'.repeat(11);

function cookieValue(setCookie: string | null): string {
  assert.ok(setCookie, 'login must return Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>(
    'SELECT id FROM students WHERE document_normalized = ANY($1::text[])',
    [[DOCUMENT_ONE, DOCUMENT_TWO]],
  );
  const studentIds = students.rows.map((row) => row.id);

  if (staffId) {
    await pool.query('DELETE FROM lessons WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
  }

  for (const studentId of studentIds) {
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = $1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM student_credentials WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  await pool.query(`DELETE FROM instructor_categories WHERE instructor_id IN (SELECT id FROM instructors WHERE display_name = 'Student Calendar Instructor')`);
  await pool.query(`DELETE FROM instructors WHERE display_name = 'Student Calendar Instructor'`);
  await pool.query(`DELETE FROM vehicles WHERE label = 'Student Calendar Vehicle'`);

  if (staffId) {
    await pool.query('DELETE FROM staff_credentials WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

async function postJson(base: string, path: string, cookie: string | null, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('STUDENT-002 projects only the authenticated Student lessons with future, past and detail views', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Student Calendar Admin Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const first = await materializeEnrollment(pool, {
    fullName: 'Aluno Calendar Um',
    phone: '11966666661',
    email: 'calendar-one@example.test',
    document: DOCUMENT_ONE,
    birthDate: '2000-01-01',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'STUDENT-002 witness one',
    actorStaffUserId: bootstrap.staffUserId,
  });
  const second = await materializeEnrollment(pool, {
    fullName: 'Aluno Calendar Dois',
    phone: '11966666662',
    email: 'calendar-two@example.test',
    document: DOCUMENT_TWO,
    birthDate: '2001-01-01',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'STUDENT-002 witness two',
    actorStaffUserId: bootstrap.staffUserId,
  });
  assert.ok(first.initialPassword);
  assert.ok(second.initialPassword);

  const instructor = await createScheduleInstructor(pool, {
    displayName: 'Student Calendar Instructor',
    categories: ['B'],
    actorStaffUserId: bootstrap.staffUserId,
  });
  const vehicle = await createScheduleVehicle(pool, {
    plate: 'STC2B01',
    label: 'Student Calendar Vehicle',
    category: 'B',
    actorStaffUserId: bootstrap.staffUserId,
  });

  const future = await createScheduleLesson(pool, {
    enrollmentId: first.enrollmentId,
    studentId: first.studentId,
    instructorId: instructor.id,
    vehicleId: vehicle.id,
    category: 'B',
    startsAt: '2030-06-10T12:00:00.000Z',
    endsAt: '2030-06-10T13:00:00.000Z',
    notes: 'Levar documento original',
    actorStaffUserId: bootstrap.staffUserId,
  });
  const past = await createScheduleLesson(pool, {
    enrollmentId: first.enrollmentId,
    studentId: first.studentId,
    instructorId: instructor.id,
    vehicleId: vehicle.id,
    category: 'B',
    startsAt: '2020-06-10T12:00:00.000Z',
    endsAt: '2020-06-10T13:00:00.000Z',
    notes: 'Aula histórica',
    actorStaffUserId: bootstrap.staffUserId,
  });
  await resolveLesson(pool, past.id, {
    status: 'COMPLETED',
    actorStaffUserId: bootstrap.staffUserId,
  });
  const otherStudentLesson = await createScheduleLesson(pool, {
    enrollmentId: second.enrollmentId,
    studentId: second.studentId,
    instructorId: instructor.id,
    vehicleId: vehicle.id,
    category: 'B',
    startsAt: '2030-06-10T14:00:00.000Z',
    endsAt: '2030-06-10T15:00:00.000Z',
    actorStaffUserId: bootstrap.staffUserId,
  });

  const handler = createStudentApiHandler(pool, { publicOrigin: ORIGIN, secureCookies: false });
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
    const unauthenticated = await fetch(`${base}/api/student/calendar`);
    assert.equal(unauthenticated.status, 401);

    const login = await postJson(base, '/api/student/auth/login', null, {
      publicId: first.studentPublicId,
      password: first.initialPassword,
    });
    assert.equal(login.status, 200);
    const cookie = cookieValue(login.headers.get('set-cookie'));

    const blockedBeforeRotation = await fetch(`${base}/api/student/calendar`, { headers: { Cookie: cookie } });
    assert.equal(blockedBeforeRotation.status, 403);

    const changed = await postJson(base, '/api/student/auth/change-initial-password', cookie, {
      newPassword: `Student-${randomUUID()}-Final`,
    });
    assert.equal(changed.status, 200);

    const calendarResponse = await fetch(`${base}/api/student/calendar`, { headers: { Cookie: cookie } });
    assert.equal(calendarResponse.status, 200);
    const calendar = await calendarResponse.json() as {
      upcoming: Array<{ id: string; instructorName: string; vehicleLabel: string; notes: string | null }>;
      past: Array<{ id: string; status: string }>;
    };
    assert.deepEqual(calendar.upcoming.map((item) => item.id), [future.id]);
    assert.equal(calendar.upcoming[0].instructorName, 'Student Calendar Instructor');
    assert.equal(calendar.upcoming[0].vehicleLabel, 'Student Calendar Vehicle');
    assert.equal(calendar.upcoming[0].notes, 'Levar documento original');
    assert.deepEqual(calendar.past.map((item) => item.id), [past.id]);
    assert.equal(calendar.past[0].status, 'COMPLETED');
    assert.equal(calendar.upcoming.some((item) => item.id === otherStudentLesson.id), false);

    const detail = await fetch(`${base}/api/student/lessons/${future.id}`, { headers: { Cookie: cookie } });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json() as { lesson: { id: string; category: string; status: string } };
    assert.equal(detailBody.lesson.id, future.id);
    assert.equal(detailBody.lesson.category, 'B');
    assert.equal(detailBody.lesson.status, 'SCHEDULED');

    const forbiddenOtherDetail = await fetch(`${base}/api/student/lessons/${otherStudentLesson.id}`, { headers: { Cookie: cookie } });
    assert.equal(forbiddenOtherDetail.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
