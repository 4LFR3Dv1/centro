import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabasePool } from '../db/pool.js';
import { materializeEnrollment } from './materialize.js';

const DOCUMENT = '55444333000';

test('ADMIN-002 rejects a second open enrollment for the same Student/service/category', async () => {
  const pool = createDatabasePool();
  const staffId = randomUUID();

  try {
    await pool.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, 'Duplicate Enrollment Test', 'ADMIN')`,
      [staffId, `duplicate-enrollment-${staffId}`],
    );

    const first = await materializeEnrollment(pool, {
      fullName: 'Aluno Duplicidade',
      phone: '12981779745',
      document: DOCUMENT,
      serviceType: 'FIRST_LICENSE',
      category: 'B',
      actorStaffUserId: staffId,
    });

    await assert.rejects(
      () => materializeEnrollment(pool, {
        fullName: 'Aluno Duplicidade',
        phone: '12981779745',
        document: DOCUMENT,
        serviceType: 'FIRST_LICENSE',
        category: 'B',
        actorStaffUserId: staffId,
      }),
      (error: unknown) => {
        const candidate = error as { code?: string; constraint?: string };
        return candidate.code === '23505' && candidate.constraint === 'enrollments_one_open_per_service_category';
      },
    );

    const enrollmentCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM enrollments WHERE student_id = $1',
      [first.studentId],
    );
    assert.equal(enrollmentCount.rows[0]?.count, '1');

    const auditCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_events
       WHERE action = 'ENROLLMENT_CREATED'
         AND entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)`,
      [first.studentId],
    );
    assert.equal(auditCount.rows[0]?.count, '1');
  } finally {
    const students = await pool.query<{ id: string }>('SELECT id FROM students WHERE document_normalized = $1', [DOCUMENT]);
    for (const row of students.rows) {
      await pool.query(
        `DELETE FROM audit_events
         WHERE actor_staff_user_id = $2
            OR entity_id = $1
            OR entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)`,
        [row.id, staffId],
      );
      await pool.query('DELETE FROM enrollments WHERE student_id = $1', [row.id]);
      await pool.query('DELETE FROM students WHERE id = $1', [row.id]);
    }
    await pool.query('DELETE FROM audit_events WHERE actor_staff_user_id = $1 OR entity_id = $1', [staffId]);
    await pool.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
    await pool.end();
  }
});
