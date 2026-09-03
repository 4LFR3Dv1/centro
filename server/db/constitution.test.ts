import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const { Client } = pg;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required for PostgreSQL constitution tests.');
  return value;
}

async function expectConstraint(
  client: InstanceType<typeof Client>,
  sql: string,
  params: unknown[],
  constraint: string,
): Promise<void> {
  await assert.rejects(
    () => client.query(sql, params),
    (error: unknown) => {
      const pgError = error as { code?: string; constraint?: string };
      return pgError.code === '23514' && pgError.constraint === constraint;
    },
  );
}

test('ADMIN-001 PostgreSQL constitution rejects impossible operational states', async () => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();

  const studentId = randomUUID();
  const staffId = randomUUID();
  const enrollmentId = randomUUID();

  try {
    const tableRows = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'students', 'enrollments', 'student_credentials',
          'staff_users', 'staff_credentials', 'sessions', 'audit_events'
        )
      ORDER BY table_name
    `);

    assert.deepEqual(
      tableRows.rows.map((row) => row.table_name),
      ['audit_events', 'enrollments', 'sessions', 'staff_credentials', 'staff_users', 'student_credentials', 'students'],
    );

    await client.query(
      `INSERT INTO students(id, public_id, full_name, phone)
       VALUES ($1, 'CEN-26-00481', 'Aluno Teste', '12999999999')`,
      [studentId],
    );

    await client.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, 'admin-test', 'Admin Teste', 'ADMIN')`,
      [staffId],
    );

    await client.query(
      `INSERT INTO enrollments(id, student_id, service_type, category, status)
       VALUES ($1, $2, 'FIRST_LICENSE', 'B', 'ACTIVE')`,
      [enrollmentId, studentId],
    );

    await assert.rejects(
      () => client.query(
        `INSERT INTO enrollments(id, student_id, service_type, category, status)
         VALUES ($1, $2, 'FIRST_LICENSE', 'B', 'ACTIVE')`,
        [randomUUID(), randomUUID()],
      ),
      (error: unknown) => (error as { code?: string }).code === '23503',
    );

    await expectConstraint(
      client,
      `INSERT INTO enrollments(id, student_id, service_type, category, status)
       VALUES ($1, $2, 'FIRST_LICENSE', 'D', 'ACTIVE')`,
      [randomUUID(), studentId],
      'enrollments_first_license_not_d',
    );

    await expectConstraint(
      client,
      `INSERT INTO students(id, public_id, full_name, phone)
       VALUES ($1, '12345678900', 'Documento Não É Login', '12988888888')`,
      [randomUUID()],
      'students_public_id_format',
    );

    await client.query(
      `INSERT INTO student_credentials(student_id, password_hash)
       VALUES ($1, '$argon2id$test-hash-not-plaintext')`,
      [studentId],
    );

    await assert.rejects(
      () => client.query(
        `INSERT INTO student_credentials(student_id, password_hash)
         VALUES ($1, '$argon2id$second-hash')`,
        [studentId],
      ),
      (error: unknown) => (error as { code?: string }).code === '23505',
    );

    await expectConstraint(
      client,
      `INSERT INTO sessions(
        id, token_hash, subject_type, student_id, staff_user_id, expires_at
       ) VALUES ($1, $2, 'STUDENT', $3, $4, now() + interval '1 hour')`,
      [randomUUID(), 'a'.repeat(64), studentId, staffId],
      'sessions_subject_exactly_one',
    );

    await expectConstraint(
      client,
      `INSERT INTO audit_events(
        id, actor_type, actor_student_id, actor_staff_user_id, action, entity_type, entity_id
       ) VALUES ($1, 'STAFF', $2, $3, 'TEST', 'Enrollment', $4)`,
      [randomUUID(), studentId, staffId, enrollmentId],
      'audit_events_actor_consistent',
    );

    const credentialColumns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'student_credentials'
      ORDER BY ordinal_position
    `);
    const names = credentialColumns.rows.map((row) => row.column_name);
    assert.ok(names.includes('password_hash'));
    assert.equal(names.includes('password'), false);
    assert.equal(names.includes('initial_password'), false);
    assert.equal(names.includes('plaintext_password'), false);

    const migrationRows = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const versions = new Set(migrationRows.rows.map((row) => row.version));
    assert.equal(versions.has('0001_operational_constitution.sql'), true);
    assert.equal(versions.has('0002_audit_actor_preservation.sql'), true);
  } finally {
    await client.end();
  }
});
