import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { resolveEnrollmentProcess } from '../process/resolver.js';
import { authenticateStaff, bootstrapFirstAdmin } from '../staff/auth.js';
import { createAdminEnrollmentIntakeApiHandler } from './admin-enrollment-intake.js';

const ORIGIN = 'https://centro-enrollment-intake.test';
const USERNAME = `enrollment-002-${randomUUID()}`;
const ADMIN_PASSWORD = `A-${randomUUID()}-witness`;
const CPF = '12345678901';

function cookie(value: string): string {
  return `centro_admin_session=${encodeURIComponent(value)}`;
}

async function cleanup(pool: ReturnType<typeof createDatabasePool>) {
  const student = await pool.query<{ id: string }>('SELECT id FROM students WHERE cpf_normalized=$1 OR document_normalized=$1', [CPF]);
  for (const { id: studentId } of student.rows) {
    const enrollments = await pool.query<{ id: string }>('SELECT id FROM enrollments WHERE student_id=$1', [studentId]);
    const enrollmentIds = enrollments.rows.map((row) => row.id);
    if (enrollmentIds.length) {
      await pool.query('DELETE FROM enrollment_milestones WHERE enrollment_id=ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollment_intake_observations WHERE enrollment_id=ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM audit_events WHERE entity_id=ANY($1::uuid[])', [enrollmentIds]);
      await pool.query('DELETE FROM enrollments WHERE id=ANY($1::uuid[])', [enrollmentIds]);
    }
    await pool.query('DELETE FROM sessions WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM student_credentials WHERE student_id=$1', [studentId]);
    const qrs = await pool.query<{ id: string }>('SELECT id FROM student_access_qrs WHERE student_id=$1', [studentId]);
    const qrIds = qrs.rows.map((row) => row.id);
    if (qrIds.length) await pool.query('DELETE FROM audit_events WHERE entity_id=ANY($1::uuid[])', [qrIds]);
    await pool.query('DELETE FROM student_access_qrs WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM audit_events WHERE actor_student_id=$1 OR entity_id=$1', [studentId]);
    await pool.query('DELETE FROM students WHERE id=$1', [studentId]);
  }

  const staff = await pool.query<{ id: string }>('SELECT id FROM staff_users WHERE username=$1', [USERNAME]);
  for (const { id } of staff.rows) {
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id=$1 OR entity_id=$1', [id]);
    await pool.query('DELETE FROM sessions WHERE staff_user_id=$1', [id]);
    await pool.query('DELETE FROM staff_credentials WHERE staff_user_id=$1', [id]);
    await pool.query('DELETE FROM staff_users WHERE id=$1', [id]);
  }
}

async function post(base: string, token: string | null, origin: string, body: unknown) {
  return fetch(`${base}/api/admin/enrollments`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Cookie: cookie(token) } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('ENROLLMENT-002 separates CPF/identity, persists intake facts and seeds only logically proven milestones', async () => {
  const pool = createDatabasePool();
  await cleanup(pool);

  const bootstrap = await bootstrapFirstAdmin(pool, {
    username: USERNAME,
    displayName: 'ENROLLMENT-002 Witness',
    password: ADMIN_PASSWORD,
  });
  assert.equal(bootstrap.created, true);

  const auth = await authenticateStaff(pool, USERNAME, ADMIN_PASSWORD);
  assert.ok(auth);

  const handler = createAdminEnrollmentIntakeApiHandler(pool, { publicOrigin: ORIGIN });
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled && !res.writableEnded) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const body = {
    fullName: 'Aluno Intake Moderno',
    cpf: CPF,
    birthDate: '2002-05-14',
    phone: '11955550123',
    email: 'intake@example.test',
    identityDocument: { type: 'CIN', number: 'CIN-998877', uf: 'SP' },
    address: { postalCode: '01001000', street: 'Praça da Sé', number: '100', complement: 'Sala 2' },
    intake: { situation: 'THEORY_EXAM_PASSED', renach: 'RENACH998877' },
    serviceType: 'FIRST_LICENSE',
    category: 'B',
    notes: 'Intake já aprovado na prova teórica',
  };

  try {
    assert.equal((await post(base, null, ORIGIN, body)).status, 401);
    assert.equal((await post(base, auth.token, 'https://wrong-origin.test', body)).status, 403);

    const invalid = await post(base, auth.token, ORIGIN, { ...body, birthDate: null });
    assert.equal(invalid.status, 400);

    const response = await post(base, auth.token, ORIGIN, body);
    assert.equal(response.status, 201);
    const receipt = await response.json() as any;
    assert.match(receipt.student.publicId, /^CEN-\d{2}-\d{5,}$/);
    assert.equal(receipt.credential.created, false);
    assert.equal(receipt.credential.initialPassword, null);
    assert.equal(receipt.enrollment.intakeSituation, 'THEORY_EXAM_PASSED');
    assert.equal(receipt.enrollment.renach, 'RENACH998877');

    const storedStudent = await pool.query<{
      cpf_normalized: string;
      document_normalized: string;
      identity_document_type: string;
      identity_document_number: string;
      identity_document_uf: string;
      postal_code: string;
      street: string;
      address_number: string;
      address_complement: string;
      birth_date: string;
    }>(
      `SELECT cpf_normalized, document_normalized, identity_document_type, identity_document_number,
              identity_document_uf, postal_code, street, address_number, address_complement,
              birth_date::text
       FROM students WHERE id=$1`,
      [receipt.student.id],
    );
    assert.equal(storedStudent.rows[0].cpf_normalized, CPF);
    assert.equal(storedStudent.rows[0].document_normalized, CPF);
    assert.equal(storedStudent.rows[0].identity_document_type, 'CIN');
    assert.equal(storedStudent.rows[0].identity_document_number, 'CIN-998877');
    assert.equal(storedStudent.rows[0].identity_document_uf, 'SP');
    assert.equal(storedStudent.rows[0].postal_code, '01001000');
    assert.equal(storedStudent.rows[0].street, 'Praça da Sé');
    assert.equal(storedStudent.rows[0].address_number, '100');
    assert.equal(storedStudent.rows[0].address_complement, 'Sala 2');
    assert.equal(storedStudent.rows[0].birth_date, '2002-05-14');

    const credentials = await pool.query('SELECT student_id FROM student_credentials WHERE student_id=$1', [receipt.student.id]);
    assert.equal(credentials.rowCount, 0);

    const qr = await pool.query('SELECT id FROM student_access_qrs WHERE student_id=$1 AND revoked_at IS NULL', [receipt.student.id]);
    assert.equal(qr.rowCount, 1);

    const observations = await pool.query<{ kind: string; value: string | null }>(
      'SELECT kind, value FROM enrollment_intake_observations WHERE enrollment_id=$1 ORDER BY kind',
      [receipt.enrollment.id],
    );
    assert.deepEqual(observations.rows, [
      { kind: 'DETRAN_PROCESS_STARTED', value: null },
      { kind: 'RENACH_OBSERVED', value: 'RENACH998877' },
      { kind: 'THEORY_COURSE_COMPLETED', value: null },
      { kind: 'THEORY_EXAM_PASSED', value: null },
    ]);

    const milestones = await pool.query<{ code: string }>(
      'SELECT code FROM enrollment_milestones WHERE enrollment_id=$1 AND achieved_at IS NOT NULL ORDER BY code',
      [receipt.enrollment.id],
    );
    assert.deepEqual(milestones.rows.map((row) => row.code).sort(), ['HEALTH_DONE', 'REGISTRATION_DONE', 'THEORY_PASSED']);

    const process = await resolveEnrollmentProcess(pool, receipt.enrollment.id);
    assert.ok(process);
    assert.equal(process.currentState.code, 'PRACTICE_DONE');

    const audit = await pool.query<{ action: string; metadata: any }>(
      `SELECT action, metadata FROM audit_events
       WHERE entity_id=$1 AND action IN ('ENROLLMENT_CREATED','ENROLLMENT_INTAKE_RECORDED')
       ORDER BY occurred_at`,
      [receipt.enrollment.id],
    );
    assert.deepEqual(audit.rows.map((row) => row.action), ['ENROLLMENT_CREATED', 'ENROLLMENT_INTAKE_RECORDED']);
    assert.equal(audit.rows[1].metadata.intakeSituation, 'THEORY_EXAM_PASSED');
    assert.deepEqual(audit.rows[1].metadata.seededMilestones, ['REGISTRATION_DONE', 'HEALTH_DONE', 'THEORY_PASSED']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await cleanup(pool);
    await pool.end();
  }
});
