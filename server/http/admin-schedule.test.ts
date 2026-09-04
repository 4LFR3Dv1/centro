import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { createAdminApiHandler } from './admin-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'schedule-admin-test';
const ADMIN_PASSWORD = `Schedule-${randomUUID()}-Admin`;
const TEST_DOCUMENT = '7'.repeat(11);

function cookieValue(setCookie: string | null): string {
  assert.ok(setCookie, 'login must return Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [ADMIN_USER]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [TEST_DOCUMENT]);
  const studentIds = students.rows.map((row) => row.id);

  if (staffId) {
    await pool.query('DELETE FROM lessons WHERE created_by_staff_user_id = $1', [staffId]);
    await pool.query(`DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR (entity_type IN ('Lesson','Instructor','Vehicle','SchedulePolicy') AND action LIKE '%SCHEDULE%')`, [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
  }

  await pool.query(`DELETE FROM instructor_categories WHERE instructor_id IN (SELECT id FROM instructors WHERE display_name LIKE 'Agenda Test%')`);
  await pool.query(`DELETE FROM instructors WHERE display_name LIKE 'Agenda Test%'`);
  await pool.query(`DELETE FROM vehicles WHERE label LIKE 'Agenda Test%'`);
  await pool.query(`DELETE FROM schedule_policies WHERE name = 'Agenda Test Policy'`);

  for (const studentId of studentIds) {
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = $1 OR entity_id = $1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM student_credentials WHERE student_id = $1', [studentId]);
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
  }

  if (staffId) {
    await pool.query('DELETE FROM staff_credentials WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

async function postJson(base: string, path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

test('SCHEDULE-002 school calendar creates resources, schedules, remaps conflicts and resolves lessons through Staff authority', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: ADMIN_USER,
    displayName: 'Schedule Admin Test',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const receipt = await materializeEnrollment(pool, {
    fullName: 'Aluno Agenda Test',
    phone: '11977777777',
    email: 'agenda@example.test',
    document: TEST_DOCUMENT,
    birthDate: '2000-01-01',
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'SCHEDULE-002 witness',
    actorStaffUserId: bootstrap.staffUserId,
  });

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
    const unauthenticated = await fetch(`${base}/api/admin/schedule/options`);
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieValue(login.headers.get('set-cookie'));

    const policyResponse = await postJson(base, '/api/admin/schedule/policy', cookie, {
      name: 'Agenda Test Policy',
      timezone: 'America/Sao_Paulo',
      slotMinutes: 30,
      lessonMinMinutes: 30,
      lessonMaxMinutes: 120,
    });
    assert.equal(policyResponse.status, 201);

    const instructor1Response = await postJson(base, '/api/admin/schedule/instructors', cookie, {
      displayName: 'Agenda Test Instrutor 1',
      categories: ['B'],
    });
    assert.equal(instructor1Response.status, 201);
    const instructor1 = (await instructor1Response.json() as { instructor: { id: string } }).instructor;

    const instructor2Response = await postJson(base, '/api/admin/schedule/instructors', cookie, {
      displayName: 'Agenda Test Instrutor 2',
      categories: ['B'],
    });
    assert.equal(instructor2Response.status, 201);
    const instructor2 = (await instructor2Response.json() as { instructor: { id: string } }).instructor;

    const vehicle1Response = await postJson(base, '/api/admin/schedule/vehicles', cookie, {
      plate: 'TST2B01',
      label: 'Agenda Test Carro 1',
      category: 'B',
    });
    assert.equal(vehicle1Response.status, 201);
    const vehicle1 = (await vehicle1Response.json() as { vehicle: { id: string } }).vehicle;

    const vehicle2Response = await postJson(base, '/api/admin/schedule/vehicles', cookie, {
      plate: 'TST2B02',
      label: 'Agenda Test Carro 2',
      category: 'B',
    });
    assert.equal(vehicle2Response.status, 201);
    const vehicle2 = (await vehicle2Response.json() as { vehicle: { id: string } }).vehicle;

    const optionsResponse = await fetch(`${base}/api/admin/schedule/options`, { headers: { Cookie: cookie } });
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json() as {
      policy: { persisted: boolean; slotMinutes: number };
      instructors: Array<{ id: string }>;
      vehicles: Array<{ id: string }>;
      enrollments: Array<{ id: string; studentId: string }>;
    };
    assert.equal(options.policy.persisted, true);
    assert.equal(options.policy.slotMinutes, 30);
    assert.ok(options.instructors.some((item) => item.id === instructor1.id));
    assert.ok(options.vehicles.some((item) => item.id === vehicle1.id));
    assert.ok(options.enrollments.some((item) => item.id === receipt.enrollmentId && item.studentId === receipt.studentId));

    const lessonResponse = await postJson(base, '/api/admin/schedule/lessons', cookie, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor1.id,
      vehicleId: vehicle1.id,
      category: 'B',
      startsAt: '2026-09-15T12:00:00.000Z',
      endsAt: '2026-09-15T13:00:00.000Z',
      notes: 'Primeira aula',
    });
    assert.equal(lessonResponse.status, 201);
    const lessonId = (await lessonResponse.json() as { lesson: { id: string } }).lesson.id;

    const conflict = await postJson(base, '/api/admin/schedule/lessons', cookie, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor2.id,
      vehicleId: vehicle2.id,
      category: 'B',
      startsAt: '2026-09-15T12:30:00.000Z',
      endsAt: '2026-09-15T13:30:00.000Z',
    });
    assert.equal(conflict.status, 409);
    const conflictBody = await conflict.json() as { error: string };
    assert.match(conflictBody.error, /aluno|Conflito de agenda/i);

    const listResponse = await fetch(
      `${base}/api/admin/schedule/lessons?from=${encodeURIComponent('2026-09-15T00:00:00.000Z')}&to=${encodeURIComponent('2026-09-16T00:00:00.000Z')}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json() as { lessons: Array<{ id: string; studentPublicId: string; status: string }> };
    assert.ok(listBody.lessons.some((lesson) => lesson.id === lessonId && lesson.studentPublicId === receipt.studentPublicId && lesson.status === 'SCHEDULED'));

    const reschedule = await postJson(base, `/api/admin/schedule/lessons/${lessonId}/reschedule`, cookie, {
      instructorId: instructor2.id,
      vehicleId: vehicle2.id,
      category: 'B',
      startsAt: '2026-09-15T13:00:00.000Z',
      endsAt: '2026-09-15T14:00:00.000Z',
      notes: 'Remarcada',
    });
    assert.equal(reschedule.status, 204);

    const complete = await postJson(base, `/api/admin/schedule/lessons/${lessonId}/resolve`, cookie, {
      status: 'COMPLETED',
      notes: 'Aula concluída',
    });
    assert.equal(complete.status, 204);

    const noShowLessonResponse = await postJson(base, '/api/admin/schedule/lessons', cookie, {
      enrollmentId: receipt.enrollmentId,
      studentId: receipt.studentId,
      instructorId: instructor1.id,
      vehicleId: vehicle1.id,
      category: 'B',
      startsAt: '2026-09-16T12:00:00.000Z',
      endsAt: '2026-09-16T13:00:00.000Z',
    });
    assert.equal(noShowLessonResponse.status, 201);
    const noShowLessonId = (await noShowLessonResponse.json() as { lesson: { id: string } }).lesson.id;

    const noShow = await postJson(base, `/api/admin/schedule/lessons/${noShowLessonId}/resolve`, cookie, {
      status: 'NO_SHOW',
    });
    assert.equal(noShow.status, 204);

    const facts = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events
       WHERE actor_staff_user_id = $1
         AND action IN ('LESSON_SCHEDULED','LESSON_RESCHEDULED','LESSON_COMPLETED','LESSON_NO_SHOW')`,
      [bootstrap.staffUserId],
    );
    const actions = new Set(facts.rows.map((row) => row.action));
    assert.equal(actions.has('LESSON_SCHEDULED'), true);
    assert.equal(actions.has('LESSON_RESCHEDULED'), true);
    assert.equal(actions.has('LESSON_COMPLETED'), true);
    assert.equal(actions.has('LESSON_NO_SHOW'), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
