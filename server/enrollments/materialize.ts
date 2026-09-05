import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  enrollmentCategories,
  serviceTypes,
  type EnrollmentCategory,
  type ServiceType,
  assertEnrollmentCombination,
} from '../ops/contracts.js';
import { formatStudentPublicId } from '../ops/credentials.js';
import { ensureStudentAccessQr } from '../student/access.js';

export const identityDocumentTypes = ['CIN', 'RG', 'RNE', 'CRNM'] as const;
export type IdentityDocumentType = typeof identityDocumentTypes[number];

export const enrollmentIntakeSituations = [
  'NOT_STARTED',
  'PROCESS_STARTED',
  'RENACH_ISSUED',
  'THEORY_COURSE_COMPLETED',
  'THEORY_EXAM_PASSED',
] as const;
export type EnrollmentIntakeSituation = typeof enrollmentIntakeSituations[number];

type IntakeObservationKind =
  | 'DETRAN_PROCESS_STARTED'
  | 'RENACH_OBSERVED'
  | 'THEORY_COURSE_COMPLETED'
  | 'THEORY_EXAM_PASSED';

export type EnrollmentMaterializationInput = {
  fullName: string;
  phone: string;
  email?: string | null;
  /** @deprecated ENROLLMENT-002 modern callers send cpf. Kept for legacy witnesses/callers. */
  document?: string;
  cpf?: string;
  birthDate?: string | null;
  identityDocument?: {
    type?: IdentityDocumentType | string;
    number?: string;
    uf?: string | null;
  } | null;
  address?: {
    postalCode?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
  } | null;
  intake?: {
    situation?: EnrollmentIntakeSituation | string;
    renach?: string | null;
  } | null;
  serviceType: ServiceType;
  category: EnrollmentCategory;
  notes?: string | null;
  actorStaffUserId: string;
};

export type EnrollmentReceipt = {
  studentId: string;
  studentPublicId: string;
  enrollmentId: string;
  /** @deprecated ACCESS-002 never creates a credential during enrollment. */
  credentialCreated: false;
  /** @deprecated ACCESS-002 never returns an initial password. */
  initialPassword: null;
  credentialExists: boolean;
  activationRequired: boolean;
  accessQr: {
    id: string;
    publicToken: string;
    created: boolean;
  };
  serviceType: ServiceType;
  category: EnrollmentCategory;
  intakeSituation: EnrollmentIntakeSituation;
  renach: string | null;
};

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function normalizeLegacyDocument(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (normalized.length < 8 || normalized.length > 20) {
    throw new Error('document must contain between 8 and 20 digits.');
  }
  return normalized;
}

function normalizeCpf(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(normalized)) throw new Error('cpf must contain exactly 11 digits.');
  if (/^(\d)\1{10}$/.test(normalized)) throw new Error('cpf is invalid.');
  return normalized;
}

function normalizeBirthDate(value: string | null | undefined, required: boolean): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    if (required) throw new Error('birthDate is required.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error('birthDate is invalid.');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (normalized > today) throw new Error('birthDate cannot be in the future.');
  return normalized;
}

function normalizeIdentityNumber(value: string): string {
  const normalized = normalizeRequired(value, 'identityDocument.number').toUpperCase();
  if (normalized.length > 40) throw new Error('identityDocument.number is too long.');
  return normalized;
}

function normalizeUf(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  if (!/^[A-Z]{2}$/.test(normalized)) throw new Error('identityDocument.uf is invalid.');
  return normalized;
}

function normalizePostalCode(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\D/g, '') ?? '';
  if (!normalized) return null;
  if (!/^\d{8}$/.test(normalized)) throw new Error('address.postalCode must contain 8 digits.');
  return normalized;
}

function normalizeOptional(value: string | null | undefined, max = 200): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > max) throw new Error('field is too long.');
  return normalized;
}

function normalizeRenach(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\s.-]/g, '').toUpperCase() ?? '';
  if (!normalized) return null;
  if (!/^[A-Z0-9]{6,20}$/.test(normalized)) throw new Error('renach is invalid.');
  return normalized;
}

function assertRuntimeEnum<T extends readonly string[]>(values: T, value: string, field: string): asserts value is T[number] {
  if (!values.includes(value)) throw new Error(`${field} is invalid.`);
}

function intakeObservationKinds(
  situation: EnrollmentIntakeSituation,
  renach: string | null,
): Array<{ kind: IntakeObservationKind; value: string | null }> {
  const observations: Array<{ kind: IntakeObservationKind; value: string | null }> = [];
  if (situation !== 'NOT_STARTED') observations.push({ kind: 'DETRAN_PROCESS_STARTED', value: null });
  if (renach) observations.push({ kind: 'RENACH_OBSERVED', value: renach });
  if (situation === 'THEORY_COURSE_COMPLETED' || situation === 'THEORY_EXAM_PASSED') {
    observations.push({ kind: 'THEORY_COURSE_COMPLETED', value: null });
  }
  if (situation === 'THEORY_EXAM_PASSED') observations.push({ kind: 'THEORY_EXAM_PASSED', value: null });
  return observations;
}

export async function materializeEnrollment(
  pool: pg.Pool,
  input: EnrollmentMaterializationInput,
): Promise<EnrollmentReceipt> {
  const fullName = normalizeRequired(input.fullName, 'fullName');
  const phone = normalizeRequired(input.phone, 'phone');
  const modernIntake = input.cpf !== undefined || input.identityDocument !== undefined || input.intake !== undefined || input.address !== undefined;
  const cpfNormalized = modernIntake ? normalizeCpf(input.cpf ?? '') : null;
  const documentNormalized = modernIntake
    ? cpfNormalized!
    : normalizeLegacyDocument(input.document ?? '');
  const birthDate = normalizeBirthDate(input.birthDate, modernIntake);
  const serviceType = input.serviceType as string;
  const category = input.category as string;

  assertRuntimeEnum(serviceTypes, serviceType, 'serviceType');
  assertRuntimeEnum(enrollmentCategories, category, 'category');
  assertEnrollmentCombination(serviceType, category);

  let identityType: IdentityDocumentType | null = null;
  let identityNumber: string | null = null;
  let identityUf: string | null = null;
  if (modernIntake) {
    const rawType = input.identityDocument?.type ?? '';
    assertRuntimeEnum(identityDocumentTypes, rawType, 'identityDocument.type');
    identityType = rawType;
    identityNumber = normalizeIdentityNumber(input.identityDocument?.number ?? '');
    identityUf = normalizeUf(input.identityDocument?.uf);
  }

  const postalCode = modernIntake ? normalizePostalCode(input.address?.postalCode) : null;
  const street = modernIntake ? normalizeOptional(input.address?.street, 200) : null;
  const addressNumber = modernIntake ? normalizeOptional(input.address?.number, 40) : null;
  const addressComplement = modernIntake ? normalizeOptional(input.address?.complement, 120) : null;

  const intakeSituationRaw = modernIntake ? input.intake?.situation ?? '' : 'NOT_STARTED';
  assertRuntimeEnum(enrollmentIntakeSituations, intakeSituationRaw, 'intake.situation');
  const intakeSituation = intakeSituationRaw;
  const renach = modernIntake ? normalizeRenach(input.intake?.renach) : null;
  if (intakeSituation === 'RENACH_ISSUED' && !renach) {
    throw new Error('renach is required when intake.situation is RENACH_ISSUED.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`student-document:${documentNormalized}`]);

    const found = await client.query<{ id: string; public_id: string }>(
      `SELECT id, public_id
       FROM students
       WHERE COALESCE(cpf_normalized, document_normalized) = $1
       FOR UPDATE`,
      [documentNormalized],
    );

    if ((found.rowCount ?? 0) > 1) throw new Error('Student identity reconciliation is ambiguous.');

    let studentId: string;
    let studentPublicId: string;
    let studentCreated = false;

    if (found.rowCount) {
      studentId = found.rows[0].id;
      studentPublicId = found.rows[0].public_id;
      await client.query(
        `UPDATE students
         SET full_name = CASE WHEN $4 THEN $5 ELSE full_name END,
             phone = $2,
             email = COALESCE($3, email),
             birth_date = COALESCE($6::date, birth_date),
             cpf_normalized = COALESCE($7, cpf_normalized),
             identity_document_type = COALESCE($8, identity_document_type),
             identity_document_number = COALESCE($9, identity_document_number),
             identity_document_uf = COALESCE($10, identity_document_uf),
             postal_code = COALESCE($11, postal_code),
             street = COALESCE($12, street),
             address_number = COALESCE($13, address_number),
             address_complement = COALESCE($14, address_complement),
             updated_at = now()
         WHERE id = $1`,
        [
          studentId,
          phone,
          input.email?.trim() || null,
          modernIntake,
          fullName,
          birthDate,
          cpfNormalized,
          identityType,
          identityNumber,
          identityUf,
          postalCode,
          street,
          addressNumber,
          addressComplement,
        ],
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
          id, public_id, full_name, phone, email, document_normalized, birth_date,
          cpf_normalized, identity_document_type, identity_document_number, identity_document_uf,
          postal_code, street, address_number, address_complement
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          studentId,
          studentPublicId,
          fullName,
          phone,
          input.email?.trim() || null,
          documentNormalized,
          birthDate,
          cpfNormalized,
          identityType,
          identityNumber,
          identityUf,
          postalCode,
          street,
          addressNumber,
          addressComplement,
        ],
      );
    }

    // ACCESS-002: enrollment never invents a password. Existing credentials are preserved;
    // new students remain credential-less until they activate their persistent QR.
    const credential = await client.query<{ student_id: string }>(
      'SELECT student_id FROM student_credentials WHERE student_id = $1',
      [studentId],
    );
    const credentialExists = Boolean(credential.rowCount);

    const accessQr = await ensureStudentAccessQr(client, studentId, input.actorStaffUserId);

    const enrollmentId = randomUUID();
    await client.query(
      `INSERT INTO enrollments(
        id, student_id, service_type, category, status, notes, renach
       ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6)`,
      [enrollmentId, studentId, serviceType, category, input.notes?.trim() || null, renach],
    );

    const observations = intakeObservationKinds(intakeSituation, renach);
    for (const observation of observations) {
      await client.query(
        `INSERT INTO enrollment_intake_observations(
           id, enrollment_id, kind, value, recorded_by_staff_user_id
         ) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), enrollmentId, observation.kind, observation.value, input.actorStaffUserId],
      );
    }

    const seededMilestones: string[] = [];
    if (serviceType === 'FIRST_LICENSE' && intakeSituation === 'THEORY_EXAM_PASSED') {
      for (const code of ['REGISTRATION_DONE', 'HEALTH_DONE', 'THEORY_PASSED']) {
        await client.query(
          `INSERT INTO enrollment_milestones(
             id, enrollment_id, code, achieved_at, achieved_by_staff_user_id, updated_by_staff_user_id, note
           ) VALUES ($1,$2,$3,now(),$4,$4,$5)`,
          [randomUUID(), enrollmentId, code, input.actorStaffUserId, 'Admitido no intake: aprovação teórica já observada.'],
        );
        seededMilestones.push(code);
      }
    }

    if (studentCreated) {
      await client.query(
        `INSERT INTO audit_events(
          id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'STAFF', $2, 'STUDENT_CREATED', 'Student', $3, $4::jsonb)`,
        [randomUUID(), input.actorStaffUserId, studentId, JSON.stringify({ publicId: studentPublicId })],
      );
    }

    await client.query(
      `INSERT INTO audit_events(
        id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
       ) VALUES ($1, 'STAFF', $2, 'ENROLLMENT_CREATED', 'Enrollment', $3, $4::jsonb)`,
      [randomUUID(), input.actorStaffUserId, enrollmentId, JSON.stringify({ studentId, publicId: studentPublicId, serviceType, category })],
    );

    if (modernIntake) {
      await client.query(
        `INSERT INTO audit_events(
          id, actor_type, actor_staff_user_id, action, entity_type, entity_id, metadata
         ) VALUES ($1, 'STAFF', $2, 'ENROLLMENT_INTAKE_RECORDED', 'Enrollment', $3, $4::jsonb)`,
        [
          randomUUID(),
          input.actorStaffUserId,
          enrollmentId,
          JSON.stringify({
            intakeSituation,
            identityDocumentType: identityType,
            renachObserved: Boolean(renach),
            addressProvided: Boolean(postalCode || street || addressNumber || addressComplement),
            seededMilestones,
          }),
        ],
      );
    }

    await client.query('COMMIT');

    return {
      studentId,
      studentPublicId,
      enrollmentId,
      credentialCreated: false,
      initialPassword: null,
      credentialExists,
      activationRequired: !credentialExists,
      accessQr: {
        id: accessQr.qr.id,
        publicToken: accessQr.qr.publicToken,
        created: accessQr.created,
      },
      serviceType,
      category,
      intakeSituation,
      renach,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be unusable */ }
    throw error;
  } finally {
    client.release();
  }
}
