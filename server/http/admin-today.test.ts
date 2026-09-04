import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { generateStudentGuide } from '../guides/student-guide.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { createAdminTodayApiHandler } from './admin-today.js';

const USERNAME = 'admin-004-witness';
const PASSPHRASE = `A4-${randomUUID()}-witness`;
const DOCUMENT_A = '8'.repeat(11);
const DOCUMENT_B = '7'.repeat(11);
const INSTRUCTOR = 'ADMIN-004 Witness Instructor';
const VEHICLE = 'ADMIN-004 Witness Vehicle';

function cookie(value: string): string {
  return `centro_admin_session=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>) {
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE lower(username) = lower($1)', [USERNAME]);
  const staffId = staff.rows[0]?.id ?? null;
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = ANY($1::text[])', [[DOCUMENT_A, DOCUMENT_B]]);
  const studentIds = students.rows.map((row) => row.id);
  if (studentIds.length) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id = ANY($1::uuid[])', [studentIds]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    await pool.query('DELETE FROM student_guides WHERE student_id = ANY($1::uuid[])', [studentIds]);
    if (enrollmentIds.length) {
      await pool.query('DELETE FROM lessons WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id = ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id = ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query('DELETE FROM sessions WHERE student_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }
  await pool.query('DELETE FROM instructor_categories WHERE instructor_id IN (SELECT id FROM instructors WHERE display_name = $1)', [INSTRUCTOR]);
  await pool.query('DELETE FROM instructors WHERE display_name = $1', [INSTRUCTOR]);
  await pool.query('DELETE FROM vehicles WHERE label = $1', [VEHICLE]);
  if (staffId) {
    await pool.query('DELETE FROM student_guides WHERE generated_by_staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id = $1', [staffId]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
  }
}

test('ADMIN-004 Today is an authenticated projection of accepted operational facts', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);
  const admin = await bootstrapFirstAdmin(pool, { username: USERNAME, displayName: 'ADMIN-004 Witness', password: PASSPHRASE });
  assert.equal(admin.created, true);
  assert.ok(admin.staffUserId);

  const scheduled = await materializeEnrollment(pool, {
    fullName: 'Scheduled Student', phone: '1'.repeat(11), document: DOCUMENT_A,
    serviceType: 'FIRST_LICENSE', category: 'B', actorStaffUserId: admin.staffUserId,
  });
  const attention = await materializeEnrollment(pool, {
    fullName: 'Attention Student', phone: '2'.repeat(11), document: DOCUMENT_B,
    serviceType: 'FIRST_LICENSE', category: 'B', actorStaffUserId: admin.staffUserId,
  });

  await generateStudentGuide(pool, {
    studentId: scheduled.studentId,
    enrollmentId: scheduled.enrollmentId,
    actorStaffUserId: admin.staffUserId,
  });
  await pool.query('UPDATE student_credentials SET must_change_password = false WHERE student_id = $1', [scheduled.studentId]);

  const instructorId = randomUUID();
  const vehicleId = randomUUID();
  await pool.query('INSERT INTO instructors(id, display_name) VALUES ($1, $2)', [instructorId, INSTRUCTOR]);
  await pool.query("INSERT INTO instructor_categories(instructor_id, category) VALUES ($1, 'B')", [instructorId]);
  await pool.query("INSERT INTO vehicles(id, plate, label, category) VALUES ($1, $2, $3, 'B')", [vehicleId, `W${Date.now().toString().slice(-6)}`, VEHICLE]);

  const lessonId = randomUUID();
  const noShowId = randomUUID();
  const start = new Date(Date.now() + 5 * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const missedStart = new Date(Date.now() - 60 * 60_000);
  const missedEnd = new Date(Date.now() - 30 * 60_000);
  await pool.query(
    `INSERT INTO lessons(id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,status,created_by_staff_user_id)
     VALUES ($1,$2,$3,$4,$5,'B',$6,$7,'SCHEDULED',$8)`,
    [lessonId, scheduled.enrollmentId, scheduled.studentId, instructorId, vehicleId, start, end, admin.staffUserId],
  );
  await pool.query(
    `INSERT INTO lessons(id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,status,resolved_at,created_by_staff_user_id)
     VALUES ($1,$2,$3,$4,$5,'B',$6,$7,'NO_SHOW',$7,$8)`,
    [noShowId, attention.enrollmentId, attention.studentId, instructorId, vehicleId, missedStart, missedEnd, admin.staffUserId],
  );
  await pool.query(
    `INSERT INTO enrollment_milestones(id,enrollment_id,code,scheduled_for,updated_by_staff_user_id)
     VALUES ($1,$2,'THEORY_PASSED',$3,$4)`,
    [randomUUID(), scheduled.enrollmentId, new Date(Date.now() + 24 * 60 * 60_000), admin.staffUserId],
  );

  const auth = await authenticateStaff(pool, USERNAME, PASSPHRASE);
  assert.ok(auth);
  const handler = createAdminTodayApiHandler(pool);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal((await fetch(`${base}/api/admin/today`)).status, 401);
    const response = await fetch(`${base}/api/admin/today`, { headers: { Cookie: cookie(auth.token) } });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.timezone, 'America/Sao_Paulo');
    assert.ok(body.lessons.some((item: any) => item.id === lessonId));
    assert.ok(body.lessons.some((item: any) => item.id === noShowId));
    assert.ok(body.upcomingExams.some((item: any) => item.enrollmentId === scheduled.enrollmentId));
    assert.ok(body.withoutNextLesson.some((item: any) => item.enrollmentId === attention.enrollmentId));
    assert.ok(!body.withoutNextLesson.some((item: any) => item.enrollmentId === scheduled.enrollmentId));
    assert.ok(body.pendingFirstAccess.some((item: any) => item.studentId === attention.studentId));
    assert.ok(!body.pendingFirstAccess.some((item: any) => item.studentId === scheduled.studentId));
    assert.ok(body.withoutGuide.some((item: any) => item.enrollmentId === attention.enrollmentId));
    assert.ok(!body.withoutGuide.some((item: any) => item.enrollmentId === scheduled.enrollmentId));
    assert.ok(body.recentNoShows.some((item: any) => item.lessonId === noShowId));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
