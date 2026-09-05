import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { bootstrapFirstAdmin } from '../staff/auth.js';
import { activateStudentAccessQr } from '../student/access.js';
import { createStudentApiHandler } from './student-api.js';
import { createStudentExperienceApiHandler } from './student-experience-api.js';

const ORIGIN = 'https://centro.test';
const ADMIN_USER = 'student-experience-admin-test';
const DOC_ONE = '91111111111';
const DOC_TWO = '92222222222';
const INSTRUCTOR_ONE = 'Instrutor Student Experience 1';
const INSTRUCTOR_TWO = 'Instrutor Student Experience 2';
const VEHICLE_ONE = 'SEXP1';
const VEHICLE_TWO = 'SEXP2';

function testPassword(label: string): string {
  return `${label}-${'x'.repeat(18)}!`;
}

function cookieValue(value: string | null): string {
  assert.ok(value);
  return value.split(';', 1)[0];
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized IN ($1,$2)', [DOC_ONE, DOC_TWO]);
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username)=lower($1)', [ADMIN_USER]);
  for (const { id: studentId } of students.rows) {
    const examSessions = await pool.query<{ session_id: string }>('SELECT DISTINCT session_id FROM practical_exam_candidates WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM practical_exam_candidates WHERE student_id=$1', [studentId]);
    for (const { session_id } of examSessions.rows) await pool.query('DELETE FROM practical_exam_sessions WHERE id=$1', [session_id]);
    await pool.query('DELETE FROM lessons WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id=$1)', [studentId]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id=$1 OR entity_id=$1 OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id=$1)', [studentId]);
    await pool.query('DELETE FROM sessions WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM students WHERE id=$1', [studentId]);
  }
  const instructors = await pool.query<{ id: string }>('SELECT id FROM instructors WHERE display_name IN ($1,$2)', [INSTRUCTOR_ONE, INSTRUCTOR_TWO]);
  for (const { id } of instructors.rows) {
    await pool.query('DELETE FROM instructor_categories WHERE instructor_id=$1', [id]);
    await pool.query('DELETE FROM instructors WHERE id=$1', [id]);
  }
  await pool.query('DELETE FROM vehicles WHERE plate IN ($1,$2)', [VEHICLE_ONE, VEHICLE_TWO]);
  const staffId = staff.rows[0]?.id;
  if (staffId) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id=$1 OR entity_id=$1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id=$1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id=$1', [staffId]);
  }
}

test('STUDENT-003..007 projects one journey, isolates exam ownership and secures QR-activated student sessions', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);
  const adminPassword = testPassword('admin');
  const firstPassword = testPassword('student-one');
  const secondPassword = testPassword('student-two');

  const bootstrap = await bootstrapFirstAdmin(pool, { username: ADMIN_USER, displayName: 'Student Experience Admin', password: adminPassword });
  assert.equal(bootstrap.created, true);
  assert.ok(bootstrap.staffUserId);

  const first = await materializeEnrollment(pool, {
    fullName: 'Aluno Experience Um', phone: '11911111111', document: DOC_ONE,
    serviceType: 'FIRST_LICENSE', category: 'B', actorStaffUserId: bootstrap.staffUserId,
  });
  const second = await materializeEnrollment(pool, {
    fullName: 'Aluno Experience Dois', phone: '11922222222', document: DOC_TWO,
    serviceType: 'FIRST_LICENSE', category: 'B', actorStaffUserId: bootstrap.staffUserId,
  });
  const firstActivation = await activateStudentAccessQr(pool, {
    publicToken: first.accessQr.publicToken,
    password: firstPassword,
  });
  const firstCookie = `centro_student_session=${encodeURIComponent(firstActivation.token)}`;

  const instructorOne = randomUUID();
  const instructorTwo = randomUUID();
  const vehicleOne = randomUUID();
  const vehicleTwo = randomUUID();
  await pool.query('INSERT INTO instructors(id,display_name) VALUES ($1,$2),($3,$4)', [instructorOne, INSTRUCTOR_ONE, instructorTwo, INSTRUCTOR_TWO]);
  await pool.query("INSERT INTO instructor_categories(instructor_id,category) VALUES ($1,'B'),($2,'B')", [instructorOne, instructorTwo]);
  await pool.query("INSERT INTO vehicles(id,plate,label,category) VALUES ($1,$2,'Carro Experience 1','B'),($3,$4,'Carro Experience 2','B')", [vehicleOne, VEHICLE_ONE, vehicleTwo, VEHICLE_TWO]);

  for (const enrollmentId of [first.enrollmentId, second.enrollmentId]) {
    for (const code of ['REGISTRATION_DONE', 'HEALTH_DONE', 'THEORY_PASSED', 'PRACTICE_DONE']) {
      await pool.query(
        `INSERT INTO enrollment_milestones(id,enrollment_id,code,achieved_at,achieved_by_staff_user_id,updated_by_staff_user_id)
         VALUES ($1,$2,$3,now(),$4,$4)`,
        [randomUUID(), enrollmentId, code, bootstrap.staffUserId],
      );
    }
  }

  const lessonStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const lessonEnd = new Date(lessonStart.getTime() + 60 * 60 * 1000);
  const lessonId = randomUUID();
  await pool.query(
    `INSERT INTO lessons(id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id)
     VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
    [lessonId, first.enrollmentId, first.studentId, instructorOne, vehicleOne, lessonStart, lessonEnd, bootstrap.staffUserId],
  );

  const examStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const examEnd = new Date(examStart.getTime() + 2 * 60 * 60 * 1000);
  const examSession = randomUUID();
  const candidateOne = randomUUID();
  await pool.query(
    `INSERT INTO practical_exam_sessions(id,category,location_label,starts_at,ends_at,instructor_id,vehicle_id,status,created_by_staff_user_id)
     VALUES ($1,'B','Banca Experience',$2,$3,$4,$5,'CONFIRMED',$6)`,
    [examSession, examStart, examEnd, instructorOne, vehicleOne, bootstrap.staffUserId],
  );
  await pool.query(
    `INSERT INTO practical_exam_candidates(id,session_id,enrollment_id,student_id,official_scheduled_for,booking_source,protocol,fee_status,ladv_status,created_by_staff_user_id)
     VALUES ($1,$2,$3,$4,$5,'SCHOOL','PROTO-ONE','PAID','READY',$6)`,
    [candidateOne, examSession, first.enrollmentId, first.studentId, new Date(examStart.getTime() + 20 * 60 * 1000), bootstrap.staffUserId],
  );

  const secondExamStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const secondSession = randomUUID();
  const candidateTwo = randomUUID();
  await pool.query(
    `INSERT INTO practical_exam_sessions(id,category,location_label,starts_at,ends_at,instructor_id,vehicle_id,status,created_by_staff_user_id)
     VALUES ($1,'B','Banca Other',$2,$3,$4,$5,'CONFIRMED',$6)`,
    [secondSession, secondExamStart, new Date(secondExamStart.getTime() + 2 * 60 * 60 * 1000), instructorTwo, vehicleTwo, bootstrap.staffUserId],
  );
  await pool.query(
    `INSERT INTO practical_exam_candidates(id,session_id,enrollment_id,student_id,official_scheduled_for,created_by_staff_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [candidateTwo, secondSession, second.enrollmentId, second.studentId, new Date(secondExamStart.getTime() + 20 * 60 * 1000), bootstrap.staffUserId],
  );

  const experience = createStudentExperienceApiHandler(pool, { publicOrigin: ORIGIN });
  const legacy = createStudentApiHandler(pool, { publicOrigin: ORIGIN, secureCookies: false });
  const server = createServer((req, res) => {
    void (async () => {
      if (await experience(req, res)) return;
      if (await legacy(req, res)) return;
      res.statusCode = 404; res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const home = await fetch(`${base}/api/student/home`, { headers: { Cookie: firstCookie } });
    assert.equal(home.status, 200);
    const homeBody = await home.json() as { primaryAction: { kind: string }; lessonSummary: { scheduled: number }; nextExam: { candidateId: string } | null };
    assert.equal(homeBody.primaryAction.kind, 'LESSON');
    assert.equal(homeBody.lessonSummary.scheduled, 1);
    assert.equal(homeBody.nextExam?.candidateId, candidateOne);

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const calendar = await fetch(`${base}/api/student/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Cookie: firstCookie } });
    assert.equal(calendar.status, 200);
    const calendarBody = await calendar.json() as { events: Array<{ kind: string; detailHref: string }> };
    assert.equal(calendarBody.events.filter((event) => event.kind === 'LESSON').length, 1);
    assert.equal(calendarBody.events.filter((event) => event.kind === 'PRACTICAL_EXAM').length, 1);
    assert.ok(calendarBody.events.every((event) => !event.detailHref.includes(candidateTwo)));

    const exams = await fetch(`${base}/api/student/exams`, { headers: { Cookie: firstCookie } });
    const examsBody = await exams.json() as { exams: Array<{ candidateId: string }> };
    assert.equal(exams.status, 200);
    assert.deepEqual(examsBody.exams.map((exam) => exam.candidateId), [candidateOne]);
    assert.equal((await fetch(`${base}/api/student/exams/${candidateTwo}`, { headers: { Cookie: firstCookie } })).status, 404);

    const secondLogin = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId: first.studentPublicId, password: firstPassword }),
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = cookieValue(secondLogin.headers.get('set-cookie'));

    const security = await fetch(`${base}/api/student/security`, { headers: { Cookie: firstCookie } });
    const securityBody = await security.json() as { activeSessions: number; passwordVersion: number };
    assert.equal(security.status, 200);
    assert.ok(securityBody.activeSessions >= 2);
    assert.equal(securityBody.passwordVersion, 1);

    const badOrigin = await fetch(`${base}/api/student/security/password`, {
      method: 'POST', headers: { Origin: 'https://evil.test', Cookie: firstCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: firstPassword, newPassword: secondPassword }),
    });
    assert.equal(badOrigin.status, 403);

    const revoke = await fetch(`${base}/api/student/security/sessions/revoke-others`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: firstCookie } });
    const revokeBody = await revoke.json() as { revokedSessions: number };
    assert.equal(revoke.status, 200);
    assert.ok(revokeBody.revokedSessions >= 1);
    assert.equal((await fetch(`${base}/api/student/auth/session`, { headers: { Cookie: secondCookie } })).status, 401);

    const wrongCurrent = await fetch(`${base}/api/student/security/password`, {
      method: 'POST', headers: { Origin: ORIGIN, Cookie: firstCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: testPassword('wrong'), newPassword: secondPassword }),
    });
    assert.equal(wrongCurrent.status, 400);

    const change = await fetch(`${base}/api/student/security/password`, {
      method: 'POST', headers: { Origin: ORIGIN, Cookie: firstCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: firstPassword, newPassword: secondPassword }),
    });
    assert.equal(change.status, 200);

    const oldLogin = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId: first.studentPublicId, password: firstPassword }),
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await fetch(`${base}/api/student/auth/login`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId: first.studentPublicId, password: secondPassword }),
    });
    assert.equal(newLogin.status, 200);

    const audits = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE actor_student_id=$1 AND action IN ('STUDENT_PASSWORD_CHANGED','STUDENT_OTHER_SESSIONS_REVOKED')`,
      [first.studentId],
    );
    assert.ok(audits.rows.some((row) => row.action === 'STUDENT_PASSWORD_CHANGED'));
    assert.ok(audits.rows.some((row) => row.action === 'STUDENT_OTHER_SESSIONS_REVOKED'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
