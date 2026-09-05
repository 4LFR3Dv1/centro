import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import { achieveProcessMilestone } from '../process/resolver.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { activateStudentAccessQr } from '../student/access.js';
import { createStudentGuideApiHandler } from './student-guide-api.js';

const ORIGIN = 'https://centro-docs-access.test';
const USER = `docs-access-${randomUUID()}`;
const DOC_A = '98765432173';
const DOC_B = '98765432174';

function secret(label: string): string {
  return `${label}-${randomUUID()}-x`;
}

function cookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>) {
  const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = ANY($1::text[])', [[DOC_A, DOC_B]]);
  for (const { id } of students.rows) {
    await pool.query('DELETE FROM student_guides WHERE student_id=$1', [id]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id=$1 OR entity_id=$1 OR entity_id IN (SELECT id FROM enrollments WHERE student_id=$1) OR entity_id IN (SELECT id FROM student_access_qrs WHERE student_id=$1)', [id]);
    await pool.query('DELETE FROM sessions WHERE student_id=$1', [id]);
    await pool.query('DELETE FROM enrollments WHERE student_id=$1', [id]);
    await pool.query('DELETE FROM students WHERE id=$1', [id]);
  }
  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE username=$1', [USER]);
  for (const { id } of staff.rows) {
    await pool.query('DELETE FROM student_guides WHERE generated_by_staff_user_id=$1', [id]);
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id=$1 OR entity_id=$1', [id]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id=$1', [id]);
    await pool.query('DELETE FROM staff_users WHERE id=$1', [id]);
  }
}

test('DOCS-001 remains isolated for QR-activated Students after ACCESS-002', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);
  const adminSecret = secret('admin');
  const admin = await bootstrapFirstAdmin(pool, { username: USER, displayName: 'Docs QR Witness', password: adminSecret });
  assert.equal(admin.created, true);
  assert.ok(admin.staffUserId);

  const a = await materializeEnrollment(pool, {
    fullName: 'Docs QR Student A', phone: '11999991003', document: DOC_A,
    serviceType: 'FIRST_LICENSE', category: 'B', actorStaffUserId: admin.staffUserId,
  });
  const b = await materializeEnrollment(pool, {
    fullName: 'Docs QR Student B', phone: '11999991004', document: DOC_B,
    serviceType: 'FIRST_LICENSE', category: 'A', actorStaffUserId: admin.staffUserId,
  });
  assert.equal(a.activationRequired, true);
  assert.equal(b.activationRequired, true);

  const activated = await activateStudentAccessQr(pool, {
    publicToken: a.accessQr.publicToken,
    password: secret('student'),
  });
  const staff = await authenticateStaff(pool, USER, adminSecret);
  assert.ok(staff);

  const handler = createStudentGuideApiHandler(pool, { publicOrigin: ORIGIN });
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled && !res.writableEnded) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const staffCookie = cookie('centro_admin_session', staff.token);
  const studentCookie = cookie('centro_student_session', activated.token);

  async function generate(studentId: string, enrollmentId: string) {
    return fetch(`${base}/api/admin/guides`, {
      method: 'POST',
      headers: { Cookie: staffCookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, enrollmentId }),
    });
  }

  try {
    const first = await generate(a.studentId, a.enrollmentId);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { receipt: { guideId: string; contentSha256: string }; guide: { snapshot: any } };
    assert.match(firstBody.receipt.contentSha256, /^[0-9a-f]{64}$/);
    assert.equal(firstBody.guide.snapshot.process.currentState.code, 'REGISTRATION_DONE');

    const own = await fetch(`${base}/api/student/guides`, { headers: { Cookie: studentCookie } });
    assert.equal(own.status, 200);
    const ownBody = await own.json() as { guides: Array<{ id: string }> };
    assert.deepEqual(ownBody.guides.map((guide) => guide.id), [firstBody.receipt.guideId]);

    const other = await generate(b.studentId, b.enrollmentId);
    assert.equal(other.status, 201);
    const otherBody = await other.json() as { receipt: { guideId: string } };
    const cross = await fetch(`${base}/api/student/guides/${otherBody.receipt.guideId}`, { headers: { Cookie: studentCookie } });
    assert.equal(cross.status, 404);

    await achieveProcessMilestone(pool, {
      enrollmentId: a.enrollmentId,
      code: 'REGISTRATION_DONE',
      actorStaffUserId: admin.staffUserId,
    });
    const second = await generate(a.studentId, a.enrollmentId);
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { receipt: { contentSha256: string }; guide: { snapshot: any } };
    assert.equal(secondBody.guide.snapshot.process.currentState.code, 'HEALTH_DONE');
    assert.notEqual(secondBody.receipt.contentSha256, firstBody.receipt.contentSha256);

    const old = await fetch(`${base}/api/student/guides/${firstBody.receipt.guideId}`, { headers: { Cookie: studentCookie } });
    assert.equal(old.status, 200);
    assert.equal((await old.json() as any).guide.snapshot.process.currentState.code, 'REGISTRATION_DONE');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
