import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export const persistentMilestoneCodes = [
  'REGISTRATION_DONE',
  'HEALTH_DONE',
  'THEORY_PASSED',
  'PRACTICE_DONE',
  'PRACTICAL_EXAM_PASSED',
  'LICENSE_AVAILABLE',
] as const;

export type PersistentMilestoneCode = typeof persistentMilestoneCodes[number];
export type ProcessMilestoneCode = 'PROCESS_STARTED' | PersistentMilestoneCode;
export type ProcessServiceType = 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
export type ProcessEnrollmentStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

type Queryable = pg.Pool | pg.PoolClient;

export class ProcessInputError extends Error {}
export class ProcessConflictError extends Error {}

export type ProcessMilestoneView = {
  code: ProcessMilestoneCode;
  label: string;
  description: string;
  achieved: boolean;
  achievedAt: Date | null;
  scheduledFor: Date | null;
  source: 'DERIVED_ENROLLMENT' | 'INSTITUTIONAL_MILESTONE';
};

export type ProcessNextAction = {
  code: string;
  title: string;
  detail: string;
  milestoneCode: ProcessMilestoneCode | null;
};

export type EnrollmentProcessView = {
  modeled: boolean;
  modelId: 'FIRST_LICENSE_V1' | null;
  enrollment: {
    id: string;
    studentId: string;
    serviceType: ProcessServiceType;
    category: 'A' | 'B' | 'AB' | 'D';
    status: ProcessEnrollmentStatus;
    openedAt: Date;
  };
  currentState: {
    code: ProcessMilestoneCode | 'COMPLETE' | 'UNMODELED_SERVICE';
    label: string;
    index: number;
    total: number;
    percent: number;
  };
  milestones: ProcessMilestoneView[];
  progress: {
    completedLessons: number;
    completedMinutes: number;
    noShows: number;
    scheduledLessons: number;
    nextLessonAt: Date | null;
  };
  nextAction: ProcessNextAction | null;
};

const FIRST_LICENSE_MILESTONES: ReadonlyArray<{
  code: ProcessMilestoneCode;
  label: string;
  description: string;
}> = [
  {
    code: 'PROCESS_STARTED',
    label: 'Processo iniciado',
    description: 'A matrícula institucional confirma que o processo começou.',
  },
  {
    code: 'REGISTRATION_DONE',
    label: 'Cadastro e biometria',
    description: 'RENACH/cadastro e biometria concluídos.',
  },
  {
    code: 'HEALTH_DONE',
    label: 'Avaliações de saúde',
    description: 'Avaliação psicológica e aptidão física/mental concluídas quando aplicáveis.',
  },
  {
    code: 'THEORY_PASSED',
    label: 'Prova teórica',
    description: 'Etapa teórica concluída e aprovação registrada.',
  },
  {
    code: 'PRACTICE_DONE',
    label: 'Preparação prática',
    description: 'Preparação prática concluída segundo a situação institucional do aluno.',
  },
  {
    code: 'PRACTICAL_EXAM_PASSED',
    label: 'Exame prático',
    description: 'Aprovação no exame prático registrada.',
  },
  {
    code: 'LICENSE_AVAILABLE',
    label: 'CNH disponível',
    description: 'Emissão/disponibilização final confirmada.',
  },
];

const SCHEDULABLE_EXAMS = new Set<PersistentMilestoneCode>(['THEORY_PASSED', 'PRACTICAL_EXAM_PASSED']);

function isPersistentMilestoneCode(value: string): value is PersistentMilestoneCode {
  return (persistentMilestoneCodes as readonly string[]).includes(value);
}

async function loadEnrollment(db: Queryable, enrollmentId: string) {
  const result = await db.query<{
    id: string;
    student_id: string;
    service_type: ProcessServiceType;
    category: 'A' | 'B' | 'AB' | 'D';
    status: ProcessEnrollmentStatus;
    opened_at: Date;
  }>(
    `SELECT id, student_id, service_type, category, status, opened_at
     FROM enrollments
     WHERE id = $1`,
    [enrollmentId],
  );
  return result.rows[0] ?? null;
}

async function loadMilestoneRows(db: Queryable, enrollmentId: string) {
  const result = await db.query<{
    code: PersistentMilestoneCode;
    scheduled_for: Date | null;
    achieved_at: Date | null;
  }>(
    `SELECT code, scheduled_for, achieved_at
     FROM enrollment_milestones
     WHERE enrollment_id = $1`,
    [enrollmentId],
  );
  return new Map(result.rows.map((row) => [row.code, row]));
}

async function loadLessonProgress(db: Queryable, enrollmentId: string) {
  const result = await db.query<{
    completed_lessons: string;
    completed_minutes: string;
    no_shows: string;
    scheduled_lessons: string;
    next_lesson_at: Date | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed_lessons,
       COALESCE(
         sum(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60) FILTER (WHERE status = 'COMPLETED'),
         0
       )::text AS completed_minutes,
       count(*) FILTER (WHERE status = 'NO_SHOW')::text AS no_shows,
       count(*) FILTER (WHERE status = 'SCHEDULED')::text AS scheduled_lessons,
       min(starts_at) FILTER (WHERE status = 'SCHEDULED' AND starts_at >= now()) AS next_lesson_at
     FROM lessons
     WHERE enrollment_id = $1`,
    [enrollmentId],
  );
  const row = result.rows[0];
  return {
    completedLessons: Number(row?.completed_lessons ?? 0),
    completedMinutes: Math.round(Number(row?.completed_minutes ?? 0)),
    noShows: Number(row?.no_shows ?? 0),
    scheduledLessons: Number(row?.scheduled_lessons ?? 0),
    nextLessonAt: row?.next_lesson_at ?? null,
  };
}

function nextActionFor(
  enrollmentStatus: ProcessEnrollmentStatus,
  current: ProcessMilestoneView | null,
  progress: EnrollmentProcessView['progress'],
): ProcessNextAction | null {
  if (enrollmentStatus === 'PAUSED') {
    return {
      code: 'PROCESS_PAUSED',
      title: 'Processo pausado pela escola',
      detail: 'A continuação depende da reativação da matrícula.',
      milestoneCode: current?.code ?? null,
    };
  }
  if (enrollmentStatus === 'CANCELLED') {
    return {
      code: 'PROCESS_CANCELLED',
      title: 'Matrícula cancelada',
      detail: 'Não existe próxima ação operacional nesta matrícula.',
      milestoneCode: null,
    };
  }
  if (!current) return null;

  switch (current.code) {
    case 'PROCESS_STARTED':
      return {
        code: 'CONFIRM_ENROLLMENT',
        title: 'Confirmar o início do processo',
        detail: 'A próxima etapa nasce quando a matrícula estiver ativa.',
        milestoneCode: current.code,
      };
    case 'REGISTRATION_DONE':
      return {
        code: 'COMPLETE_REGISTRATION',
        title: 'Concluir cadastro e biometria',
        detail: 'Registre a conclusão institucional quando RENACH/cadastro e biometria estiverem resolvidos.',
        milestoneCode: current.code,
      };
    case 'HEALTH_DONE':
      return {
        code: 'COMPLETE_HEALTH_ASSESSMENTS',
        title: 'Concluir avaliações de saúde',
        detail: 'A etapa avança somente quando a conclusão for admitida pela escola.',
        milestoneCode: current.code,
      };
    case 'THEORY_PASSED':
      return current.scheduledFor
        ? {
            code: 'ATTEND_THEORY_EXAM',
            title: 'Comparecer à prova teórica',
            detail: `Prova registrada para ${current.scheduledFor.toISOString()}.`,
            milestoneCode: current.code,
          }
        : {
            code: 'SCHEDULE_THEORY_EXAM',
            title: 'Agendar e concluir a prova teórica',
            detail: 'A aprovação é um milestone institucional; uma data de prova pode ser registrada antes da conclusão.',
            milestoneCode: current.code,
          };
    case 'PRACTICE_DONE':
      if (progress.nextLessonAt) {
        return {
          code: 'ATTEND_NEXT_LESSON',
          title: 'Comparecer à próxima aula prática',
          detail: `Próxima aula registrada para ${progress.nextLessonAt.toISOString()}.`,
          milestoneCode: current.code,
        };
      }
      if (progress.completedLessons > 0) {
        return {
          code: 'CONTINUE_PRACTICE',
          title: 'Continuar a preparação prática',
          detail: `${progress.completedLessons} aula(s) concluída(s), totalizando ${progress.completedMinutes} minuto(s) registrados no Centro.`,
          milestoneCode: current.code,
        };
      }
      return {
        code: 'SCHEDULE_FIRST_LESSON',
        title: 'Organizar a preparação prática',
        detail: 'Nenhuma aula prática concluída ou futura está registrada nesta matrícula.',
        milestoneCode: current.code,
      };
    case 'PRACTICAL_EXAM_PASSED':
      return current.scheduledFor
        ? {
            code: 'ATTEND_PRACTICAL_EXAM',
            title: 'Comparecer ao exame prático',
            detail: `Exame registrado para ${current.scheduledFor.toISOString()}.`,
            milestoneCode: current.code,
          }
        : {
            code: 'SCHEDULE_PRACTICAL_EXAM',
            title: 'Organizar o exame prático',
            detail: 'Registre a data quando conhecida e a aprovação somente depois do resultado.',
            milestoneCode: current.code,
          };
    case 'LICENSE_AVAILABLE':
      return {
        code: 'WAIT_FOR_LICENSE',
        title: 'Acompanhar a emissão da CNH',
        detail: 'O processo conclui quando a disponibilização da habilitação for confirmada.',
        milestoneCode: current.code,
      };
  }
}

export async function resolveEnrollmentProcess(db: Queryable, enrollmentId: string): Promise<EnrollmentProcessView | null> {
  const enrollment = await loadEnrollment(db, enrollmentId);
  if (!enrollment) return null;
  const progress = await loadLessonProgress(db, enrollmentId);

  if (enrollment.service_type !== 'FIRST_LICENSE') {
    return {
      modeled: false,
      modelId: null,
      enrollment: {
        id: enrollment.id,
        studentId: enrollment.student_id,
        serviceType: enrollment.service_type,
        category: enrollment.category,
        status: enrollment.status,
        openedAt: enrollment.opened_at,
      },
      currentState: {
        code: 'UNMODELED_SERVICE',
        label: 'Processo ainda não modelado para este serviço',
        index: 0,
        total: 0,
        percent: 0,
      },
      milestones: [],
      progress,
      nextAction: null,
    };
  }

  const stored = await loadMilestoneRows(db, enrollmentId);
  const started = ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(enrollment.status);
  const milestones = FIRST_LICENSE_MILESTONES.map<ProcessMilestoneView>((definition) => {
    if (definition.code === 'PROCESS_STARTED') {
      return {
        ...definition,
        achieved: started,
        achievedAt: started ? enrollment.opened_at : null,
        scheduledFor: null,
        source: 'DERIVED_ENROLLMENT',
      };
    }
    const row = stored.get(definition.code);
    return {
      ...definition,
      achieved: Boolean(row?.achieved_at),
      achievedAt: row?.achieved_at ?? null,
      scheduledFor: row?.scheduled_for ?? null,
      source: 'INSTITUTIONAL_MILESTONE',
    };
  });

  let contiguousCompleted = 0;
  for (const milestone of milestones) {
    if (!milestone.achieved) break;
    contiguousCompleted += 1;
  }
  const current = milestones[contiguousCompleted] ?? null;
  const percent = Math.round((contiguousCompleted / milestones.length) * 100);

  return {
    modeled: true,
    modelId: 'FIRST_LICENSE_V1',
    enrollment: {
      id: enrollment.id,
      studentId: enrollment.student_id,
      serviceType: enrollment.service_type,
      category: enrollment.category,
      status: enrollment.status,
      openedAt: enrollment.opened_at,
    },
    currentState: current
      ? {
          code: current.code,
          label: current.label,
          index: contiguousCompleted,
          total: milestones.length,
          percent,
        }
      : {
          code: 'COMPLETE',
          label: 'Processo concluído',
          index: milestones.length,
          total: milestones.length,
          percent: 100,
        },
    milestones,
    progress,
    nextAction: nextActionFor(enrollment.status, current, progress),
  };
}

async function insertAudit(
  client: pg.PoolClient,
  input: {
    staffUserId: string;
    action: string;
    enrollmentId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(
       id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
     ) VALUES ($1, 'STAFF', $2, $3, 'ENROLLMENT', $4, $5::jsonb)`,
    [randomUUID(), input.staffUserId, input.action, input.enrollmentId, JSON.stringify(input.metadata)],
  );
}

async function requireActiveModeledProcess(client: pg.PoolClient, enrollmentId: string): Promise<EnrollmentProcessView> {
  const process = await resolveEnrollmentProcess(client, enrollmentId);
  if (!process) throw new ProcessInputError('Matrícula não encontrada.');
  if (!process.modeled) throw new ProcessConflictError('Este tipo de serviço ainda não possui um modelo processual institucional.');
  if (process.enrollment.status !== 'ACTIVE') {
    throw new ProcessConflictError('Milestones só podem avançar enquanto a matrícula estiver ativa.');
  }
  return process;
}

export async function achieveProcessMilestone(
  pool: pg.Pool,
  input: {
    enrollmentId: string;
    code: string;
    actorStaffUserId: string;
    note?: string | null;
  },
): Promise<EnrollmentProcessView> {
  if (!isPersistentMilestoneCode(input.code)) throw new ProcessInputError('Milestone inválido.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE', [input.enrollmentId]);
    const process = await requireActiveModeledProcess(client, input.enrollmentId);
    if (process.currentState.code !== input.code) {
      throw new ProcessConflictError(`A próxima milestone derivada é ${process.currentState.code}.`);
    }

    await client.query(
      `INSERT INTO enrollment_milestones(
         id, enrollment_id, code, achieved_at, achieved_by_staff_user_id,
         updated_by_staff_user_id, note
       ) VALUES ($1, $2, $3, now(), $4, $4, $5)
       ON CONFLICT (enrollment_id, code) DO UPDATE SET
         achieved_at = now(),
         achieved_by_staff_user_id = EXCLUDED.achieved_by_staff_user_id,
         updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
         note = COALESCE(EXCLUDED.note, enrollment_milestones.note),
         updated_at = now()`,
      [randomUUID(), input.enrollmentId, input.code, input.actorStaffUserId, input.note?.trim() || null],
    );
    await insertAudit(client, {
      staffUserId: input.actorStaffUserId,
      action: 'PROCESS_MILESTONE_ACHIEVED',
      enrollmentId: input.enrollmentId,
      metadata: { code: input.code },
    });
    const updated = await resolveEnrollmentProcess(client, input.enrollmentId);
    if (!updated) throw new Error('Process disappeared during milestone achievement.');
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeProcessMilestone(
  pool: pg.Pool,
  input: {
    enrollmentId: string;
    code: string;
    actorStaffUserId: string;
    note?: string | null;
  },
): Promise<EnrollmentProcessView> {
  if (!isPersistentMilestoneCode(input.code)) throw new ProcessInputError('Milestone inválido.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE', [input.enrollmentId]);
    const process = await resolveEnrollmentProcess(client, input.enrollmentId);
    if (!process) throw new ProcessInputError('Matrícula não encontrada.');
    if (!process.modeled) throw new ProcessConflictError('Este tipo de serviço ainda não possui um modelo processual institucional.');

    const achieved = process.milestones.filter(
      (milestone): milestone is ProcessMilestoneView & { code: PersistentMilestoneCode } =>
        milestone.code !== 'PROCESS_STARTED' && milestone.achieved,
    );
    const frontier = achieved.at(-1);
    if (!frontier || frontier.code !== input.code) {
      throw new ProcessConflictError('Somente a última milestone institucional concluída pode ser revertida.');
    }

    const result = await client.query(
      `UPDATE enrollment_milestones
       SET achieved_at = NULL,
           achieved_by_staff_user_id = NULL,
           updated_by_staff_user_id = $3,
           note = COALESCE($4, note),
           updated_at = now()
       WHERE enrollment_id = $1 AND code = $2 AND achieved_at IS NOT NULL`,
      [input.enrollmentId, input.code, input.actorStaffUserId, input.note?.trim() || null],
    );
    if (result.rowCount !== 1) throw new ProcessConflictError('Milestone não está concluída.');

    await insertAudit(client, {
      staffUserId: input.actorStaffUserId,
      action: 'PROCESS_MILESTONE_REVOKED',
      enrollmentId: input.enrollmentId,
      metadata: { code: input.code },
    });
    const updated = await resolveEnrollmentProcess(client, input.enrollmentId);
    if (!updated) throw new Error('Process disappeared during milestone revocation.');
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleProcessMilestone(
  pool: pg.Pool,
  input: {
    enrollmentId: string;
    code: string;
    scheduledFor: string;
    actorStaffUserId: string;
    note?: string | null;
  },
): Promise<EnrollmentProcessView> {
  if (!isPersistentMilestoneCode(input.code) || !SCHEDULABLE_EXAMS.has(input.code)) {
    throw new ProcessInputError('Somente provas teórica e prática possuem agendamento neste corte.');
  }
  const scheduledFor = new Date(input.scheduledFor);
  if (!Number.isFinite(scheduledFor.getTime())) throw new ProcessInputError('Data de agendamento inválida.');
  if (scheduledFor.getTime() <= Date.now()) throw new ProcessInputError('O agendamento precisa estar no futuro.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM enrollments WHERE id = $1 FOR UPDATE', [input.enrollmentId]);
    const process = await requireActiveModeledProcess(client, input.enrollmentId);
    if (process.currentState.code !== input.code) {
      throw new ProcessConflictError(`A milestone ${input.code} ainda não é a etapa atual derivada.`);
    }

    await client.query(
      `INSERT INTO enrollment_milestones(
         id, enrollment_id, code, scheduled_for, updated_by_staff_user_id, note
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (enrollment_id, code) DO UPDATE SET
         scheduled_for = EXCLUDED.scheduled_for,
         updated_by_staff_user_id = EXCLUDED.updated_by_staff_user_id,
         note = COALESCE(EXCLUDED.note, enrollment_milestones.note),
         updated_at = now()`,
      [randomUUID(), input.enrollmentId, input.code, scheduledFor, input.actorStaffUserId, input.note?.trim() || null],
    );
    await insertAudit(client, {
      staffUserId: input.actorStaffUserId,
      action: 'PROCESS_MILESTONE_SCHEDULED',
      enrollmentId: input.enrollmentId,
      metadata: { code: input.code, scheduledFor: scheduledFor.toISOString() },
    });
    const updated = await resolveEnrollmentProcess(client, input.enrollmentId);
    if (!updated) throw new Error('Process disappeared during milestone scheduling.');
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveStudentProcesses(pool: pg.Pool, studentId: string): Promise<EnrollmentProcessView[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM enrollments
     WHERE student_id = $1 AND status IN ('ACTIVE', 'PAUSED')
     ORDER BY opened_at DESC, created_at DESC`,
    [studentId],
  );
  const processes = await Promise.all(result.rows.map((row) => resolveEnrollmentProcess(pool, row.id)));
  return processes.filter((process): process is EnrollmentProcessView => Boolean(process));
}

export async function listUpcomingProcessExams(
  pool: pg.Pool,
  input: { from: Date; to: Date },
): Promise<Array<{
  milestoneId: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  code: 'THEORY_PASSED' | 'PRACTICAL_EXAM_PASSED';
  scheduledFor: Date;
}>> {
  const result = await pool.query<{
    milestone_id: string;
    enrollment_id: string;
    student_id: string;
    public_id: string;
    full_name: string;
    code: 'THEORY_PASSED' | 'PRACTICAL_EXAM_PASSED';
    scheduled_for: Date;
  }>(
    `SELECT
       m.id AS milestone_id,
       m.enrollment_id,
       e.student_id,
       s.public_id,
       s.full_name,
       m.code,
       m.scheduled_for
     FROM enrollment_milestones m
     JOIN enrollments e ON e.id = m.enrollment_id
     JOIN students s ON s.id = e.student_id
     WHERE m.code IN ('THEORY_PASSED', 'PRACTICAL_EXAM_PASSED')
       AND m.achieved_at IS NULL
       AND m.scheduled_for >= $1
       AND m.scheduled_for < $2
       AND e.status = 'ACTIVE'
     ORDER BY m.scheduled_for ASC`,
    [input.from, input.to],
  );
  return result.rows.map((row) => ({
    milestoneId: row.milestone_id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentPublicId: row.public_id,
    studentName: row.full_name,
    code: row.code,
    scheduledFor: row.scheduled_for,
  }));
}
