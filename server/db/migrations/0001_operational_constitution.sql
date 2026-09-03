-- ADMIN-001 / C1 — Operational Constitution
-- This migration establishes identity, enrollment, session and audit primitives.
-- It intentionally does not create lessons, milestones, documents or UI state.

CREATE SEQUENCE IF NOT EXISTS student_public_id_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY,
  public_id varchar(24) NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  document_normalized text UNIQUE,
  birth_date date,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_public_id_format CHECK (public_id ~ '^CEN-[0-9]{2}-[0-9]{5,}$'),
  CONSTRAINT students_full_name_nonempty CHECK (btrim(full_name) <> ''),
  CONSTRAINT students_phone_nonempty CHECK (btrim(phone) <> ''),
  CONSTRAINT students_status_valid CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  service_type text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_service_type_valid CHECK (
    service_type IN ('FIRST_LICENSE', 'CATEGORY_ADDITION', 'CATEGORY_CHANGE', 'LICENSED_TRAINING')
  ),
  CONSTRAINT enrollments_category_valid CHECK (category IN ('A', 'B', 'AB', 'D')),
  CONSTRAINT enrollments_status_valid CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT enrollments_first_license_not_d CHECK (NOT (service_type = 'FIRST_LICENSE' AND category = 'D')),
  CONSTRAINT enrollments_completion_consistent CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS enrollments_student_idx ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS enrollments_status_idx ON enrollments(status);

CREATE TABLE IF NOT EXISTS student_credentials (
  student_id uuid PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  password_version integer NOT NULL DEFAULT 1,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_credentials_hash_nonempty CHECK (btrim(password_hash) <> ''),
  CONSTRAINT student_credentials_version_positive CHECK (password_version > 0),
  CONSTRAINT student_credentials_failed_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_users_username_nonempty CHECK (btrim(username) <> ''),
  CONSTRAINT staff_users_display_name_nonempty CHECK (btrim(display_name) <> ''),
  CONSTRAINT staff_users_role_valid CHECK (role IN ('STAFF', 'ADMIN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_username_unique_ci ON staff_users ((lower(username)));

CREATE TABLE IF NOT EXISTS staff_credentials (
  staff_user_id uuid PRIMARY KEY REFERENCES staff_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_version integer NOT NULL DEFAULT 1,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_credentials_hash_nonempty CHECK (btrim(password_hash) <> ''),
  CONSTRAINT staff_credentials_version_positive CHECK (password_version > 0),
  CONSTRAINT staff_credentials_failed_attempts_nonnegative CHECK (failed_attempts >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  subject_type text NOT NULL,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_user_id uuid REFERENCES staff_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  ip_hash char(64),
  user_agent text,
  CONSTRAINT sessions_subject_type_valid CHECK (subject_type IN ('STUDENT', 'STAFF')),
  CONSTRAINT sessions_subject_exactly_one CHECK (
    (subject_type = 'STUDENT' AND student_id IS NOT NULL AND staff_user_id IS NULL)
    OR
    (subject_type = 'STAFF' AND staff_user_id IS NOT NULL AND student_id IS NULL)
  ),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_student_idx ON sessions(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_staff_idx ON sessions(staff_user_id) WHERE staff_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_active_expiry_idx ON sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL,
  actor_student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  actor_staff_user_id uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_valid CHECK (actor_type IN ('SYSTEM', 'STUDENT', 'STAFF')),
  CONSTRAINT audit_events_actor_consistent CHECK (
    (actor_type = 'SYSTEM' AND actor_student_id IS NULL AND actor_staff_user_id IS NULL)
    OR
    (actor_type = 'STUDENT' AND actor_student_id IS NOT NULL AND actor_staff_user_id IS NULL)
    OR
    (actor_type = 'STAFF' AND actor_staff_user_id IS NOT NULL AND actor_student_id IS NULL)
  ),
  CONSTRAINT audit_events_action_nonempty CHECK (btrim(action) <> ''),
  CONSTRAINT audit_events_entity_type_nonempty CHECK (btrim(entity_type) <> '')
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_staff_idx ON audit_events(actor_staff_user_id, occurred_at DESC) WHERE actor_staff_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_actor_student_idx ON audit_events(actor_student_id, occurred_at DESC) WHERE actor_student_id IS NOT NULL;
