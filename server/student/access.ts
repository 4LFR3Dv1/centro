import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
} from '../ops/credentials.js';
import type { StudentEnrollmentSummary, StudentSession } from './auth.js';

type Queryable = pg.Pool | pg.PoolClient;
const SESSION_HOURS = 12;

export class StudentAccessActivationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'GONE' | 'ALREADY_ACTIVATED' | 'INVALID_PASSWORD' | 'NO_ACTIVE_ENROLLMENT',
    message: string,
  ) {
    super(message);
  }
}

export type StudentAccessQr = {
  id: string;
  studentId: string;
  publicToken: string;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
  rotatedFromId: string | null;
};

export type StudentAccessResolution = StudentAccessQr & {
  publicId: string;
  fullName: string;
  studentStatus: 'ACTIVE' | 'ARCHIVED';
  credentialExists: boolean;
  activationRequired: boolean;
};

function token(): string {
  return randomBytes(24).toString('base64url');
}

function mapRow(row: {
  id: string;
  student_id: string;
  public_token: string;
  created_at: Date;
  activated_at: Date | null;
  revoked_at: Date | null;
  rotated_from_id: string | null;
}): StudentAccessQr {
  return {
    id: row.id,
    studentId: row.student_id,
    publicToken: row.public_token,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    revokedAt: row.revoked_at,
    rotatedFromId: row.rotated_from_id,
  };
}

async function activeEnrollments(db: Queryable, studentId: string): Promise<StudentEnrollmentSummary[]> {
  const result = await db.query<{
    id: string;
    service_type: StudentEnrollmentSummary['serviceType'];
    category: StudentEnrollmentSummary['category'];
    status: 'ACTIVE';
    opened_at: Date;
  }>(
    `SELECT id, service_type, category, status, opened_at
     FROM enrollments
     WHERE student_id = $1
       AND status = 'ACTIVE'
     ORDER BY opened_at DESC, created_at DESC`,
    [studentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    serviceType: row.service_type,
    category: row.category,
    status: row.status,
    openedAt: row.opened_at,
  }));
}

export async function getCurrentStudentAccessQr(db: Queryable, studentId: string): Promise<StudentAccessQr | null> {
  const result = await db.query<{
    id: string;
    student_id: string;
    public_token: string;
    created_at: Date;
    activated_at: Date | null;
    revoked_at: Date | null;
    rotated_from_id: string | null;
  }>(
    `SELECT id, student_id, public_token, created_at, activated_at, revoked_at, rotated_from_id
     FROM student_access_qrs
     WHERE student_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function ensureStudentAccessQr(
  db: Queryable,
  studentId: string,
  actorStaffUserId?: string,
): Promise<{ qr: StudentAccessQr; created: boolean }> {
  const existing = await getCurrentStudentAccessQr(db, studentId);
  if (existing) return { qr: existing, created: false };

  const qrId = randomUUID();
  const publicToken = token();
  const inserted = await db.query<{
    id: string;
    student_id: string;
    public_token: string;
    created_at: Date;
    activated_at: Date | null;
    revoked_at: Date | null;
    rotated_from_id: string | null;
  }>(
    `INSERT INTO student_access_qrs(id, student_id, public_token, activated_at)
     VALUES (
       $1,
       $2,
       $3,
       CASE WHEN EXISTS (SELECT 1 FROM student_credentials WHERE student_id = $2) THEN now() ELSE NULL END
     )
     RETURNING id, student_id, public_token, created_at, activated_at, revoked_at, rotated_from_id`,
    [qrId, studentId, publicToken],
  );

  if (actorStaffUserId) {
    await db.query(
      `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STAFF', $2, 'STUDENT_ACCESS_QR_CREATED', 'StudentAccessQr', $3, $4::jsonb)`,
      [randomUUID(), actorStaffUserId, qrId, JSON.stringify({ studentId })],
    );
  }

  return { qr: mapRow(inserted.rows[0]), created: true };
}

export async function resolveStudentAccessQr(db: Queryable, publicToken: string): Promise<StudentAccessResolution | null> {
  const result = await db.query<{
    id: string;
    student_id: string;
    public_token: string;
    created_at: Date;
    activated_at: Date | null;
    revoked_at: Date | null;
    rotated_from_id: string | null;
    public_id: string;
    full_name: string;
    student_status: 'ACTIVE' | 'ARCHIVED';
    credential_exists: boolean;
  }>(
    `SELECT q.id, q.student_id, q.public_token, q.created_at, q.activated_at, q.revoked_at, q.rotated_from_id,
            s.public_id, s.full_name, s.status AS student_status,
            EXISTS (SELECT 1 FROM student_credentials c WHERE c.student_id = s.id) AS credential_exists
     FROM student_access_qrs q
     JOIN students s ON s.id = q.student_id
     WHERE q.public_token = $1
     LIMIT 1`,
    [publicToken],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapRow(row),
    publicId: row.public_id,
    fullName: row.full_name,
    studentStatus: row.student_status,
    credentialExists: row.credential_exists,
    activationRequired: !row.credential_exists,
  };
}

export async function activateStudentAccessQr(
  pool: pg.Pool,
  input: { publicToken: string; password: string },
): Promise<{ token: string; session: StudentSession; qr: StudentAccessQr }> {
  if (input.password.length < 12 || input.password.length > 128) {
    throw new StudentAccessActivationError('INVALID_PASSWORD', 'Use uma senha entre 12 e 128 caracteres.');
  }

  const preliminary = await resolveStudentAccessQr(pool, input.publicToken);
  if (!preliminary) throw new StudentAccessActivationError('NOT_FOUND', 'QR de acesso não encontrado.');
  if (preliminary.revokedAt || preliminary.studentStatus !== 'ACTIVE') {
    throw new StudentAccessActivationError('GONE', 'Este QR de acesso foi substituído. Use o QR atual.');
  }
  if (preliminary.credentialExists) {
    throw new StudentAccessActivationError('ALREADY_ACTIVATED', 'Este acesso já foi ativado. Entre com sua senha.');
  }

  const passwordHash = await hashPassword(input.password);
  const sessionToken = generateSessionToken();
  const sessionId = randomUUID();
  const tokenHash = hashSessionToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const student = await client.query<{ id: string; public_id: string; full_name: string; status: 'ACTIVE' | 'ARCHIVED' }>(
      `SELECT id, public_id, full_name, status
       FROM students
       WHERE id = $1
       FOR UPDATE`,
      [preliminary.studentId],
    );
    const studentRow = student.rows[0];
    if (!studentRow || studentRow.status !== 'ACTIVE') {
      throw new StudentAccessActivationError('GONE', 'Este acesso não está disponível.');
    }

    const qrResult = await client.query<{
      id: string;
      student_id: string;
      public_token: string;
      created_at: Date;
      activated_at: Date | null;
      revoked_at: Date | null;
      rotated_from_id: string | null;
    }>(
      `SELECT id, student_id, public_token, created_at, activated_at, revoked_at, rotated_from_id
       FROM student_access_qrs
       WHERE id = $1 AND student_id = $2
       FOR UPDATE`,
      [preliminary.id, preliminary.studentId],
    );
    const qrRow = qrResult.rows[0];
    if (!qrRow || qrRow.revoked_at) {
      throw new StudentAccessActivationError('GONE', 'Este QR de acesso foi substituído. Use o QR atual.');
    }

    const credential = await client.query<{ student_id: string }>(
      'SELECT student_id FROM student_credentials WHERE student_id = $1 FOR UPDATE',
      [preliminary.studentId],
    );
    if (credential.rowCount) {
      throw new StudentAccessActivationError('ALREADY_ACTIVATED', 'Este acesso já foi ativado. Entre com sua senha.');
    }

    const enrollments = await activeEnrollments(client, preliminary.studentId);
    if (enrollments.length === 0) {
      throw new StudentAccessActivationError('NO_ACTIVE_ENROLLMENT', 'Nenhuma matrícula ativa permite ativar este acesso.');
    }

    await client.query(
      `INSERT INTO student_credentials(student_id, password_hash, must_change_password)
       VALUES ($1, $2, false)`,
      [preliminary.studentId, passwordHash],
    );
    await client.query(
      `UPDATE student_access_qrs
       SET activated_at = COALESCE(activated_at, now())
       WHERE id = $1`,
      [preliminary.id],
    );
    await client.query(
      `INSERT INTO sessions(id, token_hash, subject_type, student_id, expires_at)
       VALUES ($1, $2, 'STUDENT', $3, $4)`,
      [sessionId, tokenHash, preliminary.studentId, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_ACCESS_ACTIVATED', 'StudentCredential', $2, $3::jsonb)`,
      [randomUUID(), preliminary.studentId, JSON.stringify({ qrId: preliminary.id, sessionId })],
    );
    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_student_id, action, entity_type, entity_id)
       VALUES ($1, 'STUDENT', $2, 'STUDENT_LOGIN', 'Session', $3)`,
      [randomUUID(), preliminary.studentId, sessionId],
    );

    await client.query('COMMIT');

    return {
      token: sessionToken,
      qr: { ...mapRow(qrRow), activatedAt: new Date() },
      session: {
        sessionId,
        studentId: preliminary.studentId,
        publicId: studentRow.public_id,
        fullName: studentRow.full_name,
        mustChangePassword: false,
        expiresAt,
        enrollments,
      },
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateStudentAccessQr(
  pool: pg.Pool,
  input: { studentId: string; actorStaffUserId: string },
): Promise<StudentAccessQr> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await client.query<{ id: string }>('SELECT id FROM students WHERE id = $1 FOR UPDATE', [input.studentId]);
    if (!student.rowCount) throw new Error('Student not found.');

    const current = await getCurrentStudentAccessQr(client, input.studentId);
    if (!current) {
      const created = await ensureStudentAccessQr(client, input.studentId, input.actorStaffUserId);
      await client.query('COMMIT');
      return created.qr;
    }

    await client.query('UPDATE student_access_qrs SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [current.id]);
    const qrId = randomUUID();
    const publicToken = token();
    const next = await client.query<{
      id: string;
      student_id: string;
      public_token: string;
      created_at: Date;
      activated_at: Date | null;
      revoked_at: Date | null;
      rotated_from_id: string | null;
    }>(
      `INSERT INTO student_access_qrs(id, student_id, public_token, rotated_from_id, activated_at)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         CASE WHEN EXISTS (SELECT 1 FROM student_credentials WHERE student_id = $2) THEN now() ELSE NULL END
       )
       RETURNING id, student_id, public_token, created_at, activated_at, revoked_at, rotated_from_id`,
      [qrId, input.studentId, publicToken, current.id],
    );

    await client.query(
      `INSERT INTO audit_events(id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'STAFF', $2, 'STUDENT_ACCESS_QR_ROTATED', 'StudentAccessQr', $3, $4::jsonb)`,
      [randomUUID(), input.actorStaffUserId, qrId, JSON.stringify({ studentId: input.studentId, rotatedFromId: current.id })],
    );
    await client.query('COMMIT');
    return mapRow(next.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}
