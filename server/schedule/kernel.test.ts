import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const { Client } = pg;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required for SCHEDULE-001 PostgreSQL tests.');
  return value;
}

async function expectPg(
  client: InstanceType<typeof Client>,
  sql: string,
  params: unknown[],
  code: string,
  constraint?: string,
): Promise<void> {
  await assert.rejects(
    () => client.query(sql, params),
    (error: unknown) => {
      const candidate = error as { code?: string; constraint?: string };
      return candidate.code === code && (!constraint || candidate.constraint === constraint);
    },
  );
}

test('SCHEDULE-001 PostgreSQL kernel rejects impossible lessons and resource conflicts', async () => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();

  const staffId = randomUUID();
  const studentB = randomUUID();
  const studentAb = randomUUID();
  const enrollmentB = randomUUID();
  const enrollmentAb = randomUUID();
  const instructorB1 = randomUUID();
  const instructorB2 = randomUUID();
  const instructorA = randomUUID();
  const vehicleB1 = randomUUID();
  const vehicleB2 = randomUUID();
  const vehicleA = randomUUID();
  const policy1 = randomUUID();
  const policy2 = randomUUID();
  const lessonIds: string[] = [];
  const suffix = randomInt(10000, 99999);

  const insertLesson = async (input: {
    studentId: string;
    enrollmentId: string;
    instructorId: string;
    vehicleId: string;
    category: 'A' | 'B' | 'D';
    start: string;
    end: string;
    status?: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
    resolvedAt?: string | null;
  }): Promise<string> => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO lessons(
         id, enrollment_id, student_id, instructor_id, vehicle_id, category,
         starts_at, ends_at, status, resolved_at, created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        input.enrollmentId,
        input.studentId,
        input.instructorId,
        input.vehicleId,
        input.category,
        input.start,
        input.end,
        input.status ?? 'SCHEDULED',
        input.resolvedAt ?? null,
        staffId,
      ],
    );
    lessonIds.push(id);
    return id;
  };

  try {
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('instructors', 'instructor_categories', 'vehicles', 'lessons', 'schedule_policies')
      ORDER BY table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ['instructor_categories', 'instructors', 'lessons', 'schedule_policies', 'vehicles'],
    );

    const migration = await client.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0004_lesson_kernel.sql'`,
    );
    assert.equal(migration.rowCount, 1);

    await client.query(
      `INSERT INTO staff_users(id, username, display_name, role)
       VALUES ($1, $2, 'Schedule Witness', 'ADMIN')`,
      [staffId, `schedule-${randomUUID()}`],
    );

    await client.query(
      `INSERT INTO students(id, public_id, full_name, phone)
       VALUES ($1, $2, 'Aluno B', '12990000001'),
              ($3, $4, 'Aluno AB', '12990000002')`,
      [studentB, `CEN-26-${suffix}`, studentAb, `CEN-26-${suffix + 1}`],
    );
    await client.query(
      `INSERT INTO enrollments(id, student_id, service_type, category, status)
       VALUES ($1, $2, 'FIRST_LICENSE', 'B', 'ACTIVE'),
              ($3, $4, 'FIRST_LICENSE', 'AB', 'ACTIVE')`,
      [enrollmentB, studentB, enrollmentAb, studentAb],
    );

    await client.query(
      `INSERT INTO instructors(id, display_name) VALUES
       ($1, 'Instrutor B 1'), ($2, 'Instrutor B 2'), ($3, 'Instrutor A')`,
      [instructorB1, instructorB2, instructorA],
    );
    await client.query(
      `INSERT INTO instructor_categories(instructor_id, category) VALUES
       ($1, 'B'), ($2, 'B'), ($3, 'A')`,
      [instructorB1, instructorB2, instructorA],
    );
    await client.query(
      `INSERT INTO vehicles(id, plate, label, category) VALUES
       ($1, $2, 'Carro B 1', 'B'),
       ($3, $4, 'Carro B 2', 'B'),
       ($5, $6, 'Moto A', 'A')`,
      [
        vehicleB1, `B${suffix}AA`,
        vehicleB2, `B${suffix}BB`,
        vehicleA, `A${suffix}CC`,
      ],
    );

    await client.query(
      `INSERT INTO schedule_policies(id, name, active)
       VALUES ($1, 'Política operacional', true)`,
      [policy1],
    );
    await expectPg(
      client,
      `INSERT INTO schedule_policies(id, name, active) VALUES ($1, 'Outra ativa', true)`,
      [policy2],
      '23505',
      'schedule_policies_one_active_idx',
    );

    await insertLesson({
      studentId: studentB,
      enrollmentId: enrollmentB,
      instructorId: instructorB1,
      vehicleId: vehicleB1,
      category: 'B',
      start: '2026-09-10T12:00:00.000Z',
      end: '2026-09-10T13:00:00.000Z',
    });

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentB, studentB, instructorB2, vehicleB2, '2026-09-10T12:30:00.000Z', '2026-09-10T13:30:00.000Z', staffId],
      '23P01',
      'lessons_no_student_overlap',
    );

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentAb, studentAb, instructorB1, vehicleB2, '2026-09-10T12:15:00.000Z', '2026-09-10T12:45:00.000Z', staffId],
      '23P01',
      'lessons_no_instructor_overlap',
    );

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentAb, studentAb, instructorB2, vehicleB1, '2026-09-10T12:15:00.000Z', '2026-09-10T12:45:00.000Z', staffId],
      '23P01',
      'lessons_no_vehicle_overlap',
    );

    await insertLesson({
      studentId: studentAb,
      enrollmentId: enrollmentAb,
      instructorId: instructorB2,
      vehicleId: vehicleB2,
      category: 'B',
      start: '2026-09-10T13:00:00.000Z',
      end: '2026-09-10T14:00:00.000Z',
    });

    await insertLesson({
      studentId: studentAb,
      enrollmentId: enrollmentAb,
      instructorId: instructorB2,
      vehicleId: vehicleB2,
      category: 'B',
      start: '2026-09-10T12:15:00.000Z',
      end: '2026-09-10T12:45:00.000Z',
      status: 'CANCELLED',
      resolvedAt: '2026-09-09T10:00:00.000Z',
    });

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'A',$6,$7,$8)`,
      [randomUUID(), enrollmentB, studentB, instructorA, vehicleA, '2026-09-11T12:00:00.000Z', '2026-09-11T13:00:00.000Z', staffId],
      '23514',
      'lessons_enrollment_category_compatible',
    );

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentB, studentB, instructorA, vehicleB2, '2026-09-11T14:00:00.000Z', '2026-09-11T15:00:00.000Z', staffId],
      '23514',
      'lessons_instructor_category_authorized',
    );

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentB, studentB, instructorB2, vehicleA, '2026-09-11T16:00:00.000Z', '2026-09-11T17:00:00.000Z', staffId],
      '23514',
      'lessons_vehicle_category_compatible',
    );

    await expectPg(
      client,
      `INSERT INTO lessons(
         id,enrollment_id,student_id,instructor_id,vehicle_id,category,starts_at,ends_at,created_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,'B',$6,$7,$8)`,
      [randomUUID(), enrollmentB, studentB, instructorB2, vehicleB2, '2026-09-12T12:00:00.000Z', '2026-09-12T12:00:00.000Z', staffId],
      '23514',
      'lessons_window_positive',
    );
  } finally {
    await client.query('DELETE FROM lessons WHERE created_by_staff_user_id = $1', [staffId]);
    await client.query('DELETE FROM schedule_policies WHERE id IN ($1, $2)', [policy1, policy2]);
    await client.query('DELETE FROM instructor_categories WHERE instructor_id IN ($1, $2, $3)', [instructorB1, instructorB2, instructorA]);
    await client.query('DELETE FROM vehicles WHERE id IN ($1, $2, $3)', [vehicleB1, vehicleB2, vehicleA]);
    await client.query('DELETE FROM instructors WHERE id IN ($1, $2, $3)', [instructorB1, instructorB2, instructorA]);
    await client.query('DELETE FROM enrollments WHERE id IN ($1, $2)', [enrollmentB, enrollmentAb]);
    await client.query('DELETE FROM students WHERE id IN ($1, $2)', [studentB, studentAb]);
    await client.query('DELETE FROM staff_users WHERE id = $1', [staffId]);
    await client.end();
  }
});
