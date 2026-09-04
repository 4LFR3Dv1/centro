import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { PhysicalCategory } from './contracts.js';

export type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export class ScheduleInputError extends Error {}

export type SchedulePolicyView = {
  id: string | null;
  name: string;
  timezone: string;
  slotMinutes: number;
  lessonMinMinutes: number;
  lessonMaxMinutes: number;
  persisted: boolean;
};

export type ScheduleInstructor = {
  id: string;
  displayName: string;
  active: boolean;
  categories: PhysicalCategory[];
};

export type ScheduleVehicle = {
  id: string;
  plate: string;
  label: string;
  category: PhysicalCategory;
  active: boolean;
};

export type ScheduleEnrollmentOption = {
  id: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
};

export type ScheduleLesson = {
  id: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  instructorId: string;
  instructorName: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleLabel: string;
  category: PhysicalCategory;
  startsAt: Date;
  endsAt: Date;
  status: LessonStatus;
  resolvedAt: Date | null;
  notes: string | null;
};

const DEFAULT_POLICY: SchedulePolicyView = {
  id: null,
  name: 'Política padrão',
  timezone: 'America/Sao_Paulo',
  slotMinutes: 30,
  lessonMinMinutes: 30,
  lessonMaxMinutes: 120,
  persisted: false,
};

function assertPhysicalCategory(value: string): asserts value is PhysicalCategory {
  if (value !== 'A' && value !== 'B' && value !== 'D') {
    throw new ScheduleInputError('Categoria física da aula deve ser A, B ou D.');
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ScheduleInputError(`${label} é obrigatório.`);
  return normalized;
}

function asDate(value: string | Date, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ScheduleInputError(`${label} é inválido.`);
  return date;
}

async function activePolicy(pool: pg.Pool): Promise<SchedulePolicyView> {
  const result = await pool.query<{
    id: string;
    name: string;
    timezone: string;
    slot_minutes: number;
    lesson_min_minutes: number;
    lesson_max_minutes: number;
  }>(
    `SELECT id, name, timezone, slot_minutes, lesson_min_minutes, lesson_max_minutes
     FROM schedule_policies
     WHERE active = true
     LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) return DEFAULT_POLICY;
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    slotMinutes: row.slot_minutes,
    lessonMinMinutes: row.lesson_min_minutes,
    lessonMaxMinutes: row.lesson_max_minutes,
    persisted: true,
  };
}

function validateWindow(policy: SchedulePolicyView, startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) throw new ScheduleInputError('O fim da aula deve ser posterior ao início.');
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (!Number.isInteger(durationMinutes)) throw new ScheduleInputError('A duração da aula deve usar minutos inteiros.');
  if (durationMinutes < policy.lessonMinMinutes || durationMinutes > policy.lessonMaxMinutes) {
    throw new ScheduleInputError(`A duração deve ficar entre ${policy.lessonMinMinutes} e ${policy.lessonMaxMinutes} minutos.`);
  }
  const epochMinute = Math.trunc(startsAt.getTime() / 60000);
  if (epochMinute % policy.slotMinutes !== 0) {
    throw new ScheduleInputError(`O início da aula deve respeitar slots de ${policy.slotMinutes} minutos.`);
  }
}

async function insertAudit(
  client: pg.PoolClient,
  actorStaffUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'STAFF', $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorStaffUserId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export async function getScheduleOptions(pool: pg.Pool): Promise<{
  policy: SchedulePolicyView;
  instructors: ScheduleInstructor[];
  vehicles: ScheduleVehicle[];
  enrollments: ScheduleEnrollmentOption[];
}> {
  const [policy, instructorsResult, vehiclesResult, enrollmentsResult] = await Promise.all([
    activePolicy(pool),
    pool.query<{
      id: string;
      display_name: string;
      active: boolean;
      categories: string[];
    }>(
      `SELECT i.id, i.display_name, i.active,
              COALESCE(array_agg(ic.category ORDER BY ic.category) FILTER (WHERE ic.category IS NOT NULL), ARRAY[]::text[]) AS categories
       FROM instructors i
       LEFT JOIN instructor_categories ic ON ic.instructor_id = i.id
       GROUP BY i.id
       ORDER BY i.active DESC, i.display_name ASC`,
    ),
    pool.query<{
      id: string;
      plate: string;
      label: string;
      category: PhysicalCategory;
      active: boolean;
    }>(
      `SELECT id, plate, label, category, active
       FROM vehicles
       ORDER BY active DESC, category ASC, label ASC`,
    ),
    pool.query<{
      id: string;
      student_id: string;
      public_id: string;
      full_name: string;
      service_type: ScheduleEnrollmentOption['serviceType'];
      category: ScheduleEnrollmentOption['category'];
    }>(
      `SELECT e.id, e.student_id, s.public_id, s.full_name, e.service_type, e.category
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.status = 'ACTIVE' AND s.status = 'ACTIVE'
       ORDER BY s.full_name ASC, e.opened_at DESC`,
    ),
  ]);

  return {
    policy,
    instructors: instructorsResult.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      active: row.active,
      categories: row.categories.filter((category): category is PhysicalCategory => category === 'A' || category === 'B' || category === 'D'),
    })),
    vehicles: vehiclesResult.rows.map((row) => ({
      id: row.id,
      plate: row.plate,
      label: row.label,
      category: row.category,
      active: row.active,
    })),
    enrollments: enrollmentsResult.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentPublicId: row.public_id,
      studentName: row.full_name,
      serviceType: row.service_type,
      category: row.category,
    })),
  };
}

export async function listScheduleLessons(
  pool: pg.Pool,
  input: { from: string | Date; to: string | Date; instructorId?: string; vehicleId?: string },
): Promise<ScheduleLesson[]> {
  const from = asDate(input.from, 'Início do período');
  const to = asDate(input.to, 'Fim do período');
  if (to.getTime() <= from.getTime()) throw new ScheduleInputError('O período da agenda é inválido.');
  if (to.getTime() - from.getTime() > 32 * 24 * 60 * 60 * 1000) {
    throw new ScheduleInputError('A agenda pode projetar no máximo 32 dias por consulta.');
  }

  const result = await pool.query<{
    id: string;
    enrollment_id: string;
    student_id: string;
    student_public_id: string;
    student_name: string;
    instructor_id: string;
    instructor_name: string;
    vehicle_id: string;
    vehicle_plate: string;
    vehicle_label: string;
    category: PhysicalCategory;
    starts_at: Date;
    ends_at: Date;
    status: LessonStatus;
    resolved_at: Date | null;
    notes: string | null;
  }>(
    `SELECT l.id, l.enrollment_id, l.student_id,
            s.public_id AS student_public_id, s.full_name AS student_name,
            l.instructor_id, i.display_name AS instructor_name,
            l.vehicle_id, v.plate AS vehicle_plate, v.label AS vehicle_label,
            l.category, l.starts_at, l.ends_at, l.status, l.resolved_at, l.notes
     FROM lessons l
     JOIN students s ON s.id = l.student_id
     JOIN instructors i ON i.id = l.instructor_id
     JOIN vehicles v ON v.id = l.vehicle_id
     WHERE l.starts_at < $2
       AND l.ends_at > $1
       AND ($3::uuid IS NULL OR l.instructor_id = $3)
       AND ($4::uuid IS NULL OR l.vehicle_id = $4)
     ORDER BY l.starts_at ASC, s.full_name ASC`,
    [from, to, input.instructorId || null, input.vehicleId || null],
  );

  return result.rows.map((row) => ({
    id: row.id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.student_public_id,
    studentName: row.student_name,
    instructorId: row.instructor_id,
    instructorName: row.instructor_name,
    vehicleId: row.vehicle_id,
    vehiclePlate: row.vehicle_plate,
    vehicleLabel: row.vehicle_label,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    resolvedAt: row.resolved_at,
    notes: row.notes,
  }));
}

export async function createScheduleInstructor(
  pool: pg.Pool,
  input: { displayName: string; categories: string[]; actorStaffUserId: string },
): Promise<ScheduleInstructor> {
  const displayName = required(input.displayName, 'Nome do instrutor');
  const categories = [...new Set(input.categories)];
  if (categories.length === 0) throw new ScheduleInputError('Selecione ao menos uma categoria para o instrutor.');
  for (const category of categories) assertPhysicalCategory(category);

  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO instructors(id, display_name) VALUES ($1, $2)', [id, displayName]);
    for (const category of categories) {
      await client.query('INSERT INTO instructor_categories(instructor_id, category) VALUES ($1, $2)', [id, category]);
    }
    await insertAudit(client, input.actorStaffUserId, 'INSTRUCTOR_CREATED', 'Instructor', id, { categories });
    await client.query('COMMIT');
    return { id, displayName, active: true, categories: categories as PhysicalCategory[] };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function createScheduleVehicle(
  pool: pg.Pool,
  input: { plate: string; label: string; category: string; actorStaffUserId: string },
): Promise<ScheduleVehicle> {
  const plate = required(input.plate, 'Placa').toUpperCase();
  const label = required(input.label, 'Identificação do veículo');
  assertPhysicalCategory(input.category);
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO vehicles(id, plate, label, category) VALUES ($1, $2, $3, $4)',
      [id, plate, label, input.category],
    );
    await insertAudit(client, input.actorStaffUserId, 'VEHICLE_CREATED', 'Vehicle', id, { category: input.category });
    await client.query('COMMIT');
    return { id, plate, label, category: input.category, active: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceSchedulePolicy(
  pool: pg.Pool,
  input: {
    name: string;
    timezone?: string;
    slotMinutes: number;
    lessonMinMinutes: number;
    lessonMaxMinutes: number;
    actorStaffUserId: string;
  },
): Promise<SchedulePolicyView> {
  const name = required(input.name, 'Nome da política');
  const timezone = required(input.timezone || 'America/Sao_Paulo', 'Timezone');
  if (!Number.isInteger(input.slotMinutes) || input.slotMinutes < 5 || input.slotMinutes > 120) {
    throw new ScheduleInputError('Slot deve ficar entre 5 e 120 minutos.');
  }
  if (!Number.isInteger(input.lessonMinMinutes) || input.lessonMinMinutes < 10 || input.lessonMinMinutes > 240) {
    throw new ScheduleInputError('Duração mínima deve ficar entre 10 e 240 minutos.');
  }
  if (!Number.isInteger(input.lessonMaxMinutes) || input.lessonMaxMinutes < input.lessonMinMinutes || input.lessonMaxMinutes > 480) {
    throw new ScheduleInputError('Duração máxima deve ser maior ou igual à mínima e no máximo 480 minutos.');
  }

  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE schedule_policies SET active = false, updated_at = now() WHERE active = true');
    await client.query(
      `INSERT INTO schedule_policies(id, name, timezone, slot_minutes, lesson_min_minutes, lesson_max_minutes, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [id, name, timezone, input.slotMinutes, input.lessonMinMinutes, input.lessonMaxMinutes],
    );
    await insertAudit(client, input.actorStaffUserId, 'SCHEDULE_POLICY_ACTIVATED', 'SchedulePolicy', id, {
      slotMinutes: input.slotMinutes,
      lessonMinMinutes: input.lessonMinMinutes,
      lessonMaxMinutes: input.lessonMaxMinutes,
    });
    await client.query('COMMIT');
    return {
      id,
      name,
      timezone,
      slotMinutes: input.slotMinutes,
      lessonMinMinutes: input.lessonMinMinutes,
      lessonMaxMinutes: input.lessonMaxMinutes,
      persisted: true,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function createScheduleLesson(
  pool: pg.Pool,
  input: {
    enrollmentId: string;
    studentId: string;
    instructorId: string;
    vehicleId: string;
    category: string;
    startsAt: string | Date;
    endsAt: string | Date;
    notes?: string | null;
    actorStaffUserId: string;
  },
): Promise<{ id: string }> {
  assertPhysicalCategory(input.category);
  const startsAt = asDate(input.startsAt, 'Início da aula');
  const endsAt = asDate(input.endsAt, 'Fim da aula');
  validateWindow(await activePolicy(pool), startsAt, endsAt);
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO lessons(
        id, enrollment_id, student_id, instructor_id, vehicle_id, category,
        starts_at, ends_at, notes, created_by_staff_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, input.enrollmentId, input.studentId, input.instructorId, input.vehicleId, input.category, startsAt, endsAt, input.notes?.trim() || null, input.actorStaffUserId],
    );
    await insertAudit(client, input.actorStaffUserId, 'LESSON_SCHEDULED', 'Lesson', id, {
      enrollmentId: input.enrollmentId,
      studentId: input.studentId,
      instructorId: input.instructorId,
      vehicleId: input.vehicleId,
      category: input.category,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    await client.query('COMMIT');
    return { id };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function rescheduleLesson(
  pool: pg.Pool,
  lessonId: string,
  input: {
    instructorId: string;
    vehicleId: string;
    category: string;
    startsAt: string | Date;
    endsAt: string | Date;
    notes?: string | null;
    actorStaffUserId: string;
  },
): Promise<void> {
  assertPhysicalCategory(input.category);
  const startsAt = asDate(input.startsAt, 'Início da aula');
  const endsAt = asDate(input.endsAt, 'Fim da aula');
  validateWindow(await activePolicy(pool), startsAt, endsAt);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      status: LessonStatus;
      starts_at: Date;
      ends_at: Date;
      instructor_id: string;
      vehicle_id: string;
      category: PhysicalCategory;
    }>('SELECT status, starts_at, ends_at, instructor_id, vehicle_id, category FROM lessons WHERE id = $1 FOR UPDATE', [lessonId]);
    const row = current.rows[0];
    if (!row) throw new ScheduleInputError('Aula não encontrada.');
    if (row.status !== 'SCHEDULED') throw new ScheduleInputError('Somente uma aula agendada pode ser remarcada.');

    await client.query(
      `UPDATE lessons
       SET instructor_id = $2, vehicle_id = $3, category = $4,
           starts_at = $5, ends_at = $6, notes = $7, updated_at = now()
       WHERE id = $1`,
      [lessonId, input.instructorId, input.vehicleId, input.category, startsAt, endsAt, input.notes?.trim() || null],
    );
    await insertAudit(client, input.actorStaffUserId, 'LESSON_RESCHEDULED', 'Lesson', lessonId, {
      previous: {
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        instructorId: row.instructor_id,
        vehicleId: row.vehicle_id,
        category: row.category,
      },
      next: {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        instructorId: input.instructorId,
        vehicleId: input.vehicleId,
        category: input.category,
      },
    });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveLesson(
  pool: pg.Pool,
  lessonId: string,
  input: { status: string; notes?: string | null; actorStaffUserId: string },
): Promise<void> {
  if (input.status !== 'COMPLETED' && input.status !== 'NO_SHOW' && input.status !== 'CANCELLED') {
    throw new ScheduleInputError('Resolução da aula deve ser COMPLETED, NO_SHOW ou CANCELLED.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: LessonStatus }>('SELECT status FROM lessons WHERE id = $1 FOR UPDATE', [lessonId]);
    const row = current.rows[0];
    if (!row) throw new ScheduleInputError('Aula não encontrada.');
    if (row.status !== 'SCHEDULED') throw new ScheduleInputError('A aula já foi resolvida.');

    await client.query(
      `UPDATE lessons
       SET status = $2, resolved_at = now(), notes = COALESCE(NULLIF(btrim($3), ''), notes), updated_at = now()
       WHERE id = $1`,
      [lessonId, input.status, input.notes || ''],
    );
    const action = input.status === 'COMPLETED'
      ? 'LESSON_COMPLETED'
      : input.status === 'NO_SHOW'
        ? 'LESSON_NO_SHOW'
        : 'LESSON_CANCELLED';
    await insertAudit(client, input.actorStaffUserId, action, 'Lesson', lessonId, { status: input.status });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}
