import type pg from 'pg';

export type AdminStudentIdentityDocument = {
  type: 'CIN' | 'RG' | 'RNE' | 'CRNM';
  number: string;
  uf: string | null;
};

export type AdminStudentAddress = {
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
};

export type AdminStudentSummary = {
  id: string;
  publicId: string;
  fullName: string;
  phone: string;
  email: string | null;
  document: string | null;
  cpf: string | null;
  birthDate: string | null;
  identityDocument: AdminStudentIdentityDocument | null;
  address: AdminStudentAddress | null;
  status: 'ACTIVE' | 'ARCHIVED';
  activeEnrollments: number;
  totalEnrollments: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminEnrollmentIntakeObservation = {
  id: string;
  kind: 'DETRAN_PROCESS_STARTED' | 'RENACH_OBSERVED' | 'THEORY_COURSE_COMPLETED' | 'THEORY_EXAM_PASSED';
  value: string | null;
  observedAt: Date;
  recordedByStaffUserId: string;
};

export type AdminStudentEnrollment = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  openedAt: Date;
  completedAt: Date | null;
  notes: string | null;
  renach: string | null;
  intakeObservations: AdminEnrollmentIntakeObservation[];
};

export type AdminStudentCredential = {
  exists: boolean;
  mustChangePassword: boolean;
  passwordVersion: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  disabledAt: Date | null;
  updatedAt: Date | null;
};

export type AdminStudentAuditEvent = {
  id: string;
  actorType: 'SYSTEM' | 'STUDENT' | 'STAFF';
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: Date;
};

export type AdminStudentWorkspace = {
  student: AdminStudentSummary;
  credential: AdminStudentCredential;
  enrollments: AdminStudentEnrollment[];
  recentAudit: AdminStudentAuditEvent[];
};

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value ?? 50)));
}

function mapIdentity(row: {
  identity_document_type: AdminStudentIdentityDocument['type'] | null;
  identity_document_number: string | null;
  identity_document_uf: string | null;
}): AdminStudentIdentityDocument | null {
  if (!row.identity_document_type || !row.identity_document_number) return null;
  return {
    type: row.identity_document_type,
    number: row.identity_document_number,
    uf: row.identity_document_uf,
  };
}

function mapAddress(row: {
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  address_complement: string | null;
}): AdminStudentAddress | null {
  if (!row.postal_code && !row.street && !row.address_number && !row.address_complement) return null;
  return {
    postalCode: row.postal_code,
    street: row.street,
    number: row.address_number,
    complement: row.address_complement,
  };
}

export async function listAdminStudents(
  pool: pg.Pool,
  input: { query?: string; limit?: number } = {},
): Promise<AdminStudentSummary[]> {
  const query = input.query?.trim() ?? '';
  const limit = clampLimit(input.limit);
  const documentDigits = query.replace(/\D/g, '');
  const like = `%${query}%`;
  const documentLike = documentDigits ? `%${documentDigits}%` : like;

  const result = await pool.query<{
    id: string;
    public_id: string;
    full_name: string;
    phone: string;
    email: string | null;
    document_normalized: string | null;
    cpf_normalized: string | null;
    birth_date: string | null;
    identity_document_type: AdminStudentIdentityDocument['type'] | null;
    identity_document_number: string | null;
    identity_document_uf: string | null;
    postal_code: string | null;
    street: string | null;
    address_number: string | null;
    address_complement: string | null;
    status: 'ACTIVE' | 'ARCHIVED';
    active_enrollments: string;
    total_enrollments: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       s.id,
       s.public_id,
       s.full_name,
       s.phone,
       s.email,
       s.document_normalized,
       s.cpf_normalized,
       s.birth_date,
       s.identity_document_type,
       s.identity_document_number,
       s.identity_document_uf,
       s.postal_code,
       s.street,
       s.address_number,
       s.address_complement,
       s.status,
       count(e.id) FILTER (WHERE e.status IN ('ACTIVE', 'PAUSED'))::text AS active_enrollments,
       count(e.id)::text AS total_enrollments,
       s.created_at,
       s.updated_at
     FROM students s
     LEFT JOIN enrollments e ON e.student_id = s.id
     WHERE $1 = ''
        OR s.public_id ILIKE $2
        OR s.full_name ILIKE $2
        OR s.phone ILIKE $2
        OR COALESCE(s.email, '') ILIKE $2
        OR COALESCE(s.document_normalized, '') LIKE $3
        OR COALESCE(s.cpf_normalized, '') LIKE $3
        OR COALESCE(s.identity_document_number, '') ILIKE $2
     GROUP BY s.id
     ORDER BY
       CASE WHEN lower(s.public_id) = lower($1) THEN 0 ELSE 1 END,
       s.updated_at DESC,
       s.full_name ASC
     LIMIT $4`,
    [query, like, documentLike, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    publicId: row.public_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    document: row.document_normalized,
    cpf: row.cpf_normalized,
    birthDate: row.birth_date,
    identityDocument: mapIdentity(row),
    address: mapAddress(row),
    status: row.status,
    activeEnrollments: Number(row.active_enrollments),
    totalEnrollments: Number(row.total_enrollments),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getAdminStudentWorkspace(
  pool: pg.Pool,
  studentId: string,
): Promise<AdminStudentWorkspace | null> {
  const studentResult = await pool.query<{
    id: string;
    public_id: string;
    full_name: string;
    phone: string;
    email: string | null;
    document_normalized: string | null;
    cpf_normalized: string | null;
    birth_date: string | null;
    identity_document_type: AdminStudentIdentityDocument['type'] | null;
    identity_document_number: string | null;
    identity_document_uf: string | null;
    postal_code: string | null;
    street: string | null;
    address_number: string | null;
    address_complement: string | null;
    status: 'ACTIVE' | 'ARCHIVED';
    active_enrollments: string;
    total_enrollments: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       s.id,
       s.public_id,
       s.full_name,
       s.phone,
       s.email,
       s.document_normalized,
       s.cpf_normalized,
       s.birth_date,
       s.identity_document_type,
       s.identity_document_number,
       s.identity_document_uf,
       s.postal_code,
       s.street,
       s.address_number,
       s.address_complement,
       s.status,
       count(e.id) FILTER (WHERE e.status IN ('ACTIVE', 'PAUSED'))::text AS active_enrollments,
       count(e.id)::text AS total_enrollments,
       s.created_at,
       s.updated_at
     FROM students s
     LEFT JOIN enrollments e ON e.student_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [studentId],
  );

  const studentRow = studentResult.rows[0];
  if (!studentRow) return null;

  const [credentialResult, enrollmentResult, intakeResult, auditResult] = await Promise.all([
    pool.query<{
      must_change_password: boolean;
      password_version: number;
      failed_attempts: number;
      locked_until: Date | null;
      disabled_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT must_change_password, password_version, failed_attempts, locked_until, disabled_at, updated_at
       FROM student_credentials
       WHERE student_id = $1`,
      [studentId],
    ),
    pool.query<{
      id: string;
      service_type: AdminStudentEnrollment['serviceType'];
      category: AdminStudentEnrollment['category'];
      status: AdminStudentEnrollment['status'];
      opened_at: Date;
      completed_at: Date | null;
      notes: string | null;
      renach: string | null;
    }>(
      `SELECT id, service_type, category, status, opened_at, completed_at, notes, renach
       FROM enrollments
       WHERE student_id = $1
       ORDER BY opened_at DESC, created_at DESC`,
      [studentId],
    ),
    pool.query<{
      id: string;
      enrollment_id: string;
      kind: AdminEnrollmentIntakeObservation['kind'];
      value: string | null;
      observed_at: Date;
      recorded_by_staff_user_id: string;
    }>(
      `SELECT o.id, o.enrollment_id, o.kind, o.value, o.observed_at, o.recorded_by_staff_user_id
       FROM enrollment_intake_observations o
       JOIN enrollments e ON e.id = o.enrollment_id
       WHERE e.student_id = $1
       ORDER BY o.observed_at ASC, o.created_at ASC`,
      [studentId],
    ),
    pool.query<{
      id: string;
      actor_type: AdminStudentAuditEvent['actorType'];
      action: string;
      entity_type: string;
      entity_id: string | null;
      occurred_at: Date;
    }>(
      `SELECT a.id, a.actor_type, a.action, a.entity_type, a.entity_id, a.occurred_at
       FROM audit_events a
       WHERE a.actor_student_id = $1
          OR a.entity_id = $1
          OR a.entity_id IN (SELECT id FROM enrollments WHERE student_id = $1)
          OR a.entity_id IN (SELECT id FROM student_access_qrs WHERE student_id = $1)
       ORDER BY a.occurred_at DESC
       LIMIT 40`,
      [studentId],
    ),
  ]);

  const intakeByEnrollment = new Map<string, AdminEnrollmentIntakeObservation[]>();
  for (const row of intakeResult.rows) {
    const observations = intakeByEnrollment.get(row.enrollment_id) ?? [];
    observations.push({
      id: row.id,
      kind: row.kind,
      value: row.value,
      observedAt: row.observed_at,
      recordedByStaffUserId: row.recorded_by_staff_user_id,
    });
    intakeByEnrollment.set(row.enrollment_id, observations);
  }

  const credentialRow = credentialResult.rows[0];
  return {
    student: {
      id: studentRow.id,
      publicId: studentRow.public_id,
      fullName: studentRow.full_name,
      phone: studentRow.phone,
      email: studentRow.email,
      document: studentRow.document_normalized,
      cpf: studentRow.cpf_normalized,
      birthDate: studentRow.birth_date,
      identityDocument: mapIdentity(studentRow),
      address: mapAddress(studentRow),
      status: studentRow.status,
      activeEnrollments: Number(studentRow.active_enrollments),
      totalEnrollments: Number(studentRow.total_enrollments),
      createdAt: studentRow.created_at,
      updatedAt: studentRow.updated_at,
    },
    credential: credentialRow ? {
      exists: true,
      mustChangePassword: credentialRow.must_change_password,
      passwordVersion: credentialRow.password_version,
      failedAttempts: credentialRow.failed_attempts,
      lockedUntil: credentialRow.locked_until,
      disabledAt: credentialRow.disabled_at,
      updatedAt: credentialRow.updated_at,
    } : {
      exists: false,
      mustChangePassword: false,
      passwordVersion: null,
      failedAttempts: 0,
      lockedUntil: null,
      disabledAt: null,
      updatedAt: null,
    },
    enrollments: enrollmentResult.rows.map((row) => ({
      id: row.id,
      serviceType: row.service_type,
      category: row.category,
      status: row.status,
      openedAt: row.opened_at,
      completedAt: row.completed_at,
      notes: row.notes,
      renach: row.renach,
      intakeObservations: intakeByEnrollment.get(row.id) ?? [],
    })),
    recentAudit: auditResult.rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
    })),
  };
}
