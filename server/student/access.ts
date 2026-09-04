import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';

type Queryable = pg.Pool | pg.PoolClient;

export type StudentAccessQr = {
  id: string;
  studentId: string;
  publicToken: string;
  createdAt: Date;
  revokedAt: Date | null;
  rotatedFromId: string | null;
};

export type StudentAccessResolution = StudentAccessQr & {
  publicId: string;
  fullName: string;
  studentStatus: 'ACTIVE' | 'ARCHIVED';
};

function token(): string {
  return randomBytes(24).toString('base64url');
}

function mapRow(row: {
  id: string;
  student_id: string;
  public_token: string;
  created_at: Date;
  revoked_at: Date | null;
  rotated_from_id: string | null;
}): StudentAccessQr {
  return {
    id: row.id,
    studentId: row.student_id,
    publicToken: row.public_token,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    rotatedFromId: row.rotated_from_id,
  };
}

export async function getCurrentStudentAccessQr(db: Queryable, studentId: string): Promise<StudentAccessQr | null> {
  const result = await db.query<{
    id: string;
    student_id: string;
    public_token: string;
    created_at: Date;
    revoked_at: Date | null;
    rotated_from_id: string | null;
  }>(
    `SELECT id, student_id, public_token, created_at, revoked_at, rotated_from_id
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
    revoked_at: Date | null;
    rotated_from_id: string | null;
  }>(
    `INSERT INTO student_access_qrs(id, student_id, public_token)
     VALUES ($1, $2, $3)
     RETURNING id, student_id, public_token, created_at, revoked_at, rotated_from_id`,
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
    revoked_at: Date | null;
    rotated_from_id: string | null;
    public_id: string;
    full_name: string;
    student_status: 'ACTIVE' | 'ARCHIVED';
  }>(
    `SELECT q.id, q.student_id, q.public_token, q.created_at, q.revoked_at, q.rotated_from_id,
            s.public_id, s.full_name, s.status AS student_status
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
  };
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
      revoked_at: Date | null;
      rotated_from_id: string | null;
    }>(
      `INSERT INTO student_access_qrs(id, student_id, public_token, rotated_from_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, student_id, public_token, created_at, revoked_at, rotated_from_id`,
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
