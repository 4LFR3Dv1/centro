import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from './materialize.js';

const TEST_DOCUMENT = '12345678901';
const ROLLBACK_DOCUMENT = '98765432100';

async function seedStaff(pool: ReturnType<typeof createDatabasePool>): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO staff_users(id, username, display_name, role)
     VALUES ($1, $2, 'Admin Enrollment Test', 'ADMIN')`,
    [id, `admin-enrollment-${id}`],
  );
  return id;
}

async function cleanupStudents(pool: ReturnType<typeof createDatabasePool>, staffId?: string): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events
     WHERE ($3::uuid IS NOT NULL AND actor_staff_user_id = $3)
        OR entity_id IN (
          SELECT id FROM students WHERE document_normalized IN ($1, $2)
          UNION
          SELECT e.id
          FROM enrollments e
          JOIN students s ON s.id = e.student_id
          WHERE s.document_normalized IN ($1, $2)
          UNION
          SELECT q.id
          FROM student_access_qrs q
          JOIN students s ON s.id = q.student_id
          WHERE s.document_normalized IN ($1, $2)
        )`,
    [TEST_DOCUMENT, ROLLBACK_DOCUMENT, staffId ?? null],
  );
  await pool.query(
    `DELETE FROM enrollments
     WHERE student_id IN (
       SELECT id FROM students WHERE document_normalized IN ($1, $2)
     )`,
    [TEST_DOCUMENT, ROLLBACK_DOCUMENT],
  );
  await pool.query(
    'DELETE FROM students WHERE document_normalized IN ($1, $2)',
    [TEST_DOCUMENT, ROLLBACK_DOCUMENT],
  );
}

test('ACCESS-002 materializes Student + Enrollment + persistent QR atomically without inventing a password', async () => {
  const pool = createDatabasePool();
  const staffId = await seedStaff(pool);

  try {
    await cleanupStudents(pool);

    const first = await materializeEnrollment(pool, {
      fullName: 'João da Silva',
      phone: '12981779745',
      email: 'joao@example.test',
      document: TEST_DOCUMENT,
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: staffId,
    });

    assert.match(first.studentPublicId, /^CEN-\d{2}-\d{5,}$/);
    assert.equal(first.credentialCreated, false);
    assert.equal(first.initialPassword, null);
    assert.equal(first.credentialExists, false);
    assert.equal(first.activationRequired, true);
    assert.equal(first.accessQr.created, true);
    assert.ok(first.accessQr.publicToken.length >= 20);

    const studentRows = await pool.query<{ public_id: string }>(
      'SELECT public_id FROM students WHERE id = $1',
      [first.studentId],
    );
    assert.equal(studentRows.rows[0]?.public_id, first.studentPublicId);

    const credentialRows = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM student_credentials WHERE student_id = $1',
      [first.studentId],
    );
    assert.equal(credentialRows.rows[0]?.count, '0', 'enrollment must not create StudentCredential');

    const second = await materializeEnrollment(pool, {
      fullName: 'João da Silva',
      phone: '12981779745',
      document: TEST_DOCUMENT,
      serviceType: 'CATEGORY_ADDITION',
      category: 'A',
      actorStaffUserId: staffId,
    });

    assert.equal(second.studentId, first.studentId);
    assert.equal(second.studentPublicId, first.studentPublicId);
    assert.equal(second.credentialExists, false);
    assert.equal(second.activationRequired, true);
    assert.equal(second.accessQr.created, false);
    assert.equal(second.accessQr.publicToken, first.accessQr.publicToken);

    const enrollmentCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM enrollments WHERE student_id = $1',
      [first.studentId],
    );
    assert.equal(enrollmentCount.rows[0]?.count, '2');

    const audit = await pool.query<{ action: string }>(
      `SELECT action
       FROM audit_events
       WHERE entity_id IN ($1, $2, $3)
          OR (action = 'STUDENT_ACCESS_QR_CREATED' AND metadata ->> 'studentId' = $1::text)
       ORDER BY occurred_at`,
      [first.studentId, first.enrollmentId, second.enrollmentId],
    );
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_CREATED'));
    assert.ok(audit.rows.some((row) => row.action === 'STUDENT_ACCESS_QR_CREATED'));
    assert.equal(audit.rows.some((row) => row.action === 'STUDENT_CREDENTIAL_CREATED'), false);
    assert.equal(audit.rows.filter((row) => row.action === 'ENROLLMENT_CREATED').length, 2);

    await assert.rejects(
      () => pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]),
      (error: unknown) => (error as { code?: string }).code === '23503',
    );

    const invalidStaffId = randomUUID();
    await assert.rejects(
      () => materializeEnrollment(pool, {
        fullName: 'Rollback Student',
        phone: '12900000000',
        document: ROLLBACK_DOCUMENT,
        serviceType: 'FIRST_LICENSE',
        category: 'B',
        actorStaffUserId: invalidStaffId,
      }),
      (error: unknown) => (error as { code?: string }).code === '23503',
    );

    const rolledBack = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM students WHERE document_normalized = $1',
      [ROLLBACK_DOCUMENT],
    );
    assert.equal(rolledBack.rows[0]?.count, '0');
  } finally {
    await cleanupStudents(pool, staffId);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
    await pool.end();
  }
});
