import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  enrollmentCategories,
  serviceTypes,
  type EnrollmentCategory,
  type ServiceType,
  assertEnrollmentCombination,
} from '../ops/contracts.js';
import {
  formatStudentPublicId,
  generateInitialPassword,
  hashPassword,
} from '../ops/credentials.js';
import { ensureStudentAccessQr } from '../student/access.js';

export type EnrollmentMaterializationInput = {
  fullName: string;
  phone: string;
  email?: string | null;
  document: string;
  birthDate?: string | null;
  serviceType: ServiceType;
  category: EnrollmentCategory;
  notes?: string | null;
  actorStaffUserId: string;
};

export type EnrollmentReceipt = {
  studentId: string;
  studentPublicId: string;
  enrollmentId: string;
  credentialCreated: boolean;
  initialPassword: string | null;
  accessQr: {
    id: string;
    publicToken: string;
    created: boolean;
  };
  serviceType: ServiceType;
  category: EnrollmentCategory;
};

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeDocument(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (normalized.length < 8 || normalized.length > 20) {
    throw new Error('document must contain between 8 and 20 digits.');
  }
  return normalized;
}

function assertRuntimeEnum<T extends readonly string[]>(values: T, value: string, field: string): asserts value is T[number] {
  if (!values.includes(value)) throw new Error(`${field} is invalid.`);
}

export async function materializeEnrollment(
  pool: pg.Pool,
  input: EnrollmentMaterializationInput,
): Promise<EnrollmentReceipt> {
  const fullName = normalizeRequired(input.fullName, 'fullName');
  const phone = normalizeRequired(input.phone, 'phone');
  const documentNormalized = normalizeDocument(input.document);
  const serviceType = input.serviceType as string;
  const category = input.category as string;

  assertRuntimeEnum(serviceTypes, serviceType, 'serviceType');
  assertRuntimeEnum(enrollmentCategories, category, 'category');
  assertEnrollmentCombination(serviceType, category);

  const client = await pool.connect();
  let initialPassword: string | null = null;

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`student-document:${documentNormalized}`]);

    const found = await client.query<{ id: string; public_id: string }>(
      `SELECT id, public_id
       FROM students
       WHERE document_normalized = $1
       FOR UPDATE`,
      [documentNormalized],
    );

    let studentId: string;
    let studentPublicId: string;
    let studentCreated = false;

    if (found.rowCount) {
      studentId = found.rows[0].id;
      studentPublicId = found.rows[0].public_id;
      await client.query(
        `UPDATE students
         SET phone = $2,
             email = COALESCE($3, email),
             updated_at = now()
         WHERE id = $1`,
        [studentId, phone, input.email?.trim() || null],
      );
    } else {
      const sequence = await client.query<{ value: string }>(`SELECT nextval('student_public_id_seq')::text AS value`);
      const number = Number(sequence.rows[0]?.value);
      if (!Number.isSafeInteger(number)) throw new Error('Student public ID sequence returned an invalid value.');

      studentId = randomUUID();
      studentPublicId = formatStudentPublicId(number);
      studentCreated = true;

      await client.query(
        `INSERT INTO students(
          id, public_id, full_name, phone, email, document_normalized, birth_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [studentId, studentPublicId, fullName, phone, input.email?.trim() || null, documentNormalized, input.birthDate || null],
      );
    }

    const credential = await client.query<{ student_id: string }>(
      'SELECT student_id FROM student_credentials WHERE student_id = $1',
      [studentId],
    );

    let credentialCreated = false;
    if (!credential.rowCount) {
      initialPassword = generateInitialPassword();
      const passwordHash = await hashPassword(initialPassword);
      await client.query(
        `INSERT INTO student_credentials(student_id, password_hash, must_change_password)
         VALUES ($1, $2, true)`,
        [studentId, passwordHash],
      );
      credentialCreated = true;
    }

    const accessQr = await ensureStudentAccessQr(client, studentId, input.actorStaffUserId);

    const enrollmentId = randomUUID();
    await client.query(
      `INSERT INTO enrollments(
        id, student_id, service_type, category, status, notes
       ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [enrollmentId, studentId, serviceType, category, input.notes?.trim() || null],
    );

    if (studentCreated) {
      await client.query(
        `INSERT INTO audit_events(
          id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'STAFF', $2, 'STUDENT_CREATED', 'Student', $3, $4::jsonb)`,
        [randomUUID(), input.actorStaffUserId, studentId, JSON.stringify({ publicId: studentPublicId })],
      );
    }

    if (credentialCreated) {
      await client.query(
        `INSERT INTO audit_events(
          id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'STAFF', $2, 'STUDENT_CREDENTIAL_CREATED', 'StudentCredential', $3, '{}'::jsonb)`,
        [randomUUID(), input.actorStaffUserId, studentId],
      );
    }

    await client.query(
      `INSERT INTO audit_events(
        id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
       ) VALUES ($1, 'STAFF', $2, 'ENROLLMENT_CREATED', 'Enrollment', $3, $4::jsonb)`,
      [randomUUID(), input.actorStaffUserId, enrollmentId, JSON.stringify({ studentId, publicId: studentPublicId, serviceType, category })],
    );

    await client.query('COMMIT');

    return {
      studentId,
      studentPublicId,
      enrollmentId,
      credentialCreated,
      initialPassword,
      accessQr: {
        id: accessQr.qr.id,
        publicToken: accessQr.qr.publicToken,
        created: accessQr.created,
      },
      serviceType,
      category,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be unusable */ }
    initialPassword = null;
    throw error;
  } finally {
    client.release();
  }
}
