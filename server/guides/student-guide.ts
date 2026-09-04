import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { resolveEnrollmentProcess, type EnrollmentProcessView } from '../process/resolver.js';
import type { PhysicalCategory } from '../schedule/contracts.js';

export const STUDENT_GUIDE_TEMPLATE = {
  id: 'CENTRO_STUDENT_GUIDE',
  version: 1,
  snapshotSchema: 'CENTRO_STUDENT_GUIDE_SNAPSHOT_V1',
} as const;

type Queryable = pg.Pool | pg.PoolClient;

type GuideLessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export class StudentGuideInputError extends Error {}

export type StudentGuideLesson = {
  id: string;
  category: PhysicalCategory;
  startsAt: string;
  endsAt: string;
  status: GuideLessonStatus;
  instructorName: string;
  vehicleLabel: string;
  notes: string | null;
};

export type StudentGuideSnapshot = {
  schema: typeof STUDENT_GUIDE_TEMPLATE.snapshotSchema;
  student: {
    id: string;
    publicId: string;
    fullName: string;
  };
  enrollment: {
    id: string;
    serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
    category: 'A' | 'B' | 'AB' | 'D';
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
    openedAt: string;
  };
  process: {
    modeled: boolean;
    modelId: EnrollmentProcessView['modelId'];
    currentState: EnrollmentProcessView['currentState'];
    milestones: Array<{
      code: string;
      label: string;
      description: string;
      achieved: boolean;
      achievedAt: string | null;
      scheduledFor: string | null;
    }>;
    progress: Omit<EnrollmentProcessView['progress'], 'nextLessonAt'> & { nextLessonAt: string | null };
    nextAction: EnrollmentProcessView['nextAction'];
  };
  agenda: {
    upcoming: StudentGuideLesson[];
    recent: StudentGuideLesson[];
  };
};

export type StudentGuideRecord = {
  id: string;
  studentId: string;
  enrollmentId: string;
  templateId: string;
  templateVersion: number;
  contentSha256: string;
  generatedAt: Date;
  snapshot: StudentGuideSnapshot;
};

export type StudentGuidePreview = {
  template: typeof STUDENT_GUIDE_TEMPLATE;
  snapshot: StudentGuideSnapshot;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function digestStudentGuideSnapshot(snapshot: StudentGuideSnapshot): string {
  return createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex');
}

async function loadGuideIdentity(db: Queryable, studentId: string, enrollmentId: string) {
  const result = await db.query<{
    student_id: string;
    public_id: string;
    full_name: string;
    enrollment_id: string;
    service_type: StudentGuideSnapshot['enrollment']['serviceType'];
    category: StudentGuideSnapshot['enrollment']['category'];
    status: StudentGuideSnapshot['enrollment']['status'];
    opened_at: Date;
  }>(
    `SELECT
       s.id AS student_id,
       s.public_id,
       s.full_name,
       e.id AS enrollment_id,
       e.service_type,
       e.category,
       e.status,
       e.opened_at
     FROM students s
     JOIN enrollments e ON e.student_id = s.id
     WHERE s.id = $1 AND e.id = $2
     LIMIT 1`,
    [studentId, enrollmentId],
  );
  const row = result.rows[0];
  if (!row) throw new StudentGuideInputError('Aluno ou matrícula não encontrados.');
  return row;
}

async function loadGuideLessons(db: Queryable, studentId: string, enrollmentId: string) {
  type Row = {
    id: string;
    category: PhysicalCategory;
    starts_at: Date;
    ends_at: Date;
    status: GuideLessonStatus;
    instructor_name: string;
    vehicle_label: string;
    notes: string | null;
  };

  const [upcoming, recent] = await Promise.all([
    db.query<Row>(
      `SELECT l.id, l.category, l.starts_at, l.ends_at, l.status,
              i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
       FROM lessons l
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.student_id = $1
         AND l.enrollment_id = $2
         AND l.status = 'SCHEDULED'
         AND l.ends_at >= now()
       ORDER BY l.starts_at ASC
       LIMIT 12`,
      [studentId, enrollmentId],
    ),
    db.query<Row>(
      `SELECT l.id, l.category, l.starts_at, l.ends_at, l.status,
              i.display_name AS instructor_name, v.label AS vehicle_label, l.notes
       FROM lessons l
       JOIN instructors i ON i.id = l.instructor_id
       JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.student_id = $1
         AND l.enrollment_id = $2
         AND (l.status <> 'SCHEDULED' OR l.ends_at < now())
       ORDER BY l.starts_at DESC
       LIMIT 8`,
      [studentId, enrollmentId],
    ),
  ]);

  const map = (row: Row): StudentGuideLesson => ({
    id: row.id,
    category: row.category,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    instructorName: row.instructor_name,
    vehicleLabel: row.vehicle_label,
    notes: row.notes,
  });

  return {
    upcoming: upcoming.rows.map(map),
    recent: recent.rows.map(map),
  };
}

function serializeProcess(process: EnrollmentProcessView): StudentGuideSnapshot['process'] {
  return {
    modeled: process.modeled,
    modelId: process.modelId,
    currentState: process.currentState,
    milestones: process.milestones.map((milestone) => ({
      code: milestone.code,
      label: milestone.label,
      description: milestone.description,
      achieved: milestone.achieved,
      achievedAt: milestone.achievedAt?.toISOString() ?? null,
      scheduledFor: milestone.scheduledFor?.toISOString() ?? null,
    })),
    progress: {
      completedLessons: process.progress.completedLessons,
      completedMinutes: process.progress.completedMinutes,
      noShows: process.progress.noShows,
      scheduledLessons: process.progress.scheduledLessons,
      nextLessonAt: process.progress.nextLessonAt?.toISOString() ?? null,
    },
    nextAction: process.nextAction,
  };
}

async function buildStudentGuideSnapshot(
  db: Queryable,
  studentId: string,
  enrollmentId: string,
): Promise<StudentGuideSnapshot> {
  const identity = await loadGuideIdentity(db, studentId, enrollmentId);
  const [process, agenda] = await Promise.all([
    resolveEnrollmentProcess(db, enrollmentId),
    loadGuideLessons(db, studentId, enrollmentId),
  ]);
  if (!process) throw new StudentGuideInputError('Processo da matrícula não encontrado.');

  return {
    schema: STUDENT_GUIDE_TEMPLATE.snapshotSchema,
    student: {
      id: identity.student_id,
      publicId: identity.public_id,
      fullName: identity.full_name,
    },
    enrollment: {
      id: identity.enrollment_id,
      serviceType: identity.service_type,
      category: identity.category,
      status: identity.status,
      openedAt: identity.opened_at.toISOString(),
    },
    process: serializeProcess(process),
    agenda,
  };
}

export async function previewStudentGuide(
  pool: pg.Pool,
  input: { studentId: string; enrollmentId: string },
): Promise<StudentGuidePreview> {
  return {
    template: STUDENT_GUIDE_TEMPLATE,
    snapshot: await buildStudentGuideSnapshot(pool, input.studentId, input.enrollmentId),
  };
}

function mapRecord(row: {
  id: string;
  student_id: string;
  enrollment_id: string;
  template_id: string;
  template_version: number;
  snapshot: StudentGuideSnapshot;
  content_sha256: string;
  generated_at: Date;
}): StudentGuideRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    enrollmentId: row.enrollment_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    snapshot: row.snapshot,
    contentSha256: row.content_sha256,
    generatedAt: row.generated_at,
  };
}

export async function generateStudentGuide(
  pool: pg.Pool,
  input: { studentId: string; enrollmentId: string; actorStaffUserId: string },
): Promise<StudentGuideRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const snapshot = await buildStudentGuideSnapshot(client, input.studentId, input.enrollmentId);
    const digest = digestStudentGuideSnapshot(snapshot);
    const id = randomUUID();

    const result = await client.query<{
      id: string;
      student_id: string;
      enrollment_id: string;
      template_id: string;
      template_version: number;
      snapshot: StudentGuideSnapshot;
      content_sha256: string;
      generated_at: Date;
    }>(
      `INSERT INTO student_guides(
         id, student_id, enrollment_id, template_id, template_version,
         snapshot, content_sha256, generated_by_staff_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       RETURNING id, student_id, enrollment_id, template_id, template_version,
                 snapshot, content_sha256, generated_at`,
      [
        id,
        input.studentId,
        input.enrollmentId,
        STUDENT_GUIDE_TEMPLATE.id,
        STUDENT_GUIDE_TEMPLATE.version,
        JSON.stringify(snapshot),
        digest,
        input.actorStaffUserId,
      ],
    );

    await client.query(
      `INSERT INTO audit_events(
         id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
       ) VALUES ($1, 'STAFF', $2, 'STUDENT_GUIDE_GENERATED', 'STUDENT_GUIDE', $3, $4::jsonb)`,
      [
        randomUUID(),
        input.actorStaffUserId,
        id,
        JSON.stringify({
          studentId: input.studentId,
          enrollmentId: input.enrollmentId,
          templateId: STUDENT_GUIDE_TEMPLATE.id,
          templateVersion: STUDENT_GUIDE_TEMPLATE.version,
          contentSha256: digest,
        }),
      ],
    );

    await client.query('COMMIT');
    return mapRecord(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listStudentGuides(pool: pg.Pool, studentId: string): Promise<StudentGuideRecord[]> {
  const result = await pool.query<{
    id: string;
    student_id: string;
    enrollment_id: string;
    template_id: string;
    template_version: number;
    snapshot: StudentGuideSnapshot;
    content_sha256: string;
    generated_at: Date;
  }>(
    `SELECT id, student_id, enrollment_id, template_id, template_version,
            snapshot, content_sha256, generated_at
     FROM student_guides
     WHERE student_id = $1
     ORDER BY generated_at DESC, id DESC
     LIMIT 50`,
    [studentId],
  );
  return result.rows.map(mapRecord);
}

export async function getStudentGuide(
  pool: pg.Pool,
  guideId: string,
  studentId?: string,
): Promise<StudentGuideRecord | null> {
  const params: unknown[] = [guideId];
  let predicate = 'id = $1';
  if (studentId) {
    params.push(studentId);
    predicate += ' AND student_id = $2';
  }
  const result = await pool.query<{
    id: string;
    student_id: string;
    enrollment_id: string;
    template_id: string;
    template_version: number;
    snapshot: StudentGuideSnapshot;
    content_sha256: string;
    generated_at: Date;
  }>(
    `SELECT id, student_id, enrollment_id, template_id, template_version,
            snapshot, content_sha256, generated_at
     FROM student_guides
     WHERE ${predicate}
     LIMIT 1`,
    params,
  );
  return result.rows[0] ? mapRecord(result.rows[0]) : null;
}
