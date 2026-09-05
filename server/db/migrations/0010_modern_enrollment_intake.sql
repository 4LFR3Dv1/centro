-- ENROLLMENT-002 — Modern Enrollment Intake
-- Intake choices are expanded into durable facts. There is deliberately no mutable current_step.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS cpf_normalized text,
  ADD COLUMN IF NOT EXISTS identity_document_type text,
  ADD COLUMN IF NOT EXISTS identity_document_number text,
  ADD COLUMN IF NOT EXISTS identity_document_uf text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text;

UPDATE students
SET cpf_normalized = document_normalized
WHERE cpf_normalized IS NULL
  AND document_normalized ~ '^[0-9]{11}$';

CREATE UNIQUE INDEX IF NOT EXISTS students_cpf_unique
  ON students(cpf_normalized)
  WHERE cpf_normalized IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_cpf_format'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_cpf_format
      CHECK (cpf_normalized IS NULL OR cpf_normalized ~ '^[0-9]{11}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_identity_document_type_valid'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_identity_document_type_valid
      CHECK (identity_document_type IS NULL OR identity_document_type IN ('CIN', 'RG', 'RNE', 'CRNM'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_identity_document_consistent'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_identity_document_consistent
      CHECK (
        (identity_document_type IS NULL AND identity_document_number IS NULL)
        OR
        (identity_document_type IS NOT NULL AND identity_document_number IS NOT NULL AND btrim(identity_document_number) <> '')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_identity_document_uf_format'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_identity_document_uf_format
      CHECK (identity_document_uf IS NULL OR identity_document_uf ~ '^[A-Z]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_postal_code_format'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_postal_code_format
      CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{8}$');
  END IF;
END $$;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS renach text;

CREATE UNIQUE INDEX IF NOT EXISTS enrollments_renach_unique
  ON enrollments(renach)
  WHERE renach IS NOT NULL;

CREATE TABLE IF NOT EXISTS enrollment_intake_observations (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  value text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollment_intake_observations_kind_valid CHECK (
    kind IN (
      'DETRAN_PROCESS_STARTED',
      'RENACH_OBSERVED',
      'THEORY_COURSE_COMPLETED',
      'THEORY_EXAM_PASSED'
    )
  ),
  CONSTRAINT enrollment_intake_observations_value_consistent CHECK (
    (kind = 'RENACH_OBSERVED' AND value IS NOT NULL AND btrim(value) <> '')
    OR
    (kind <> 'RENACH_OBSERVED' AND value IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_intake_observations_one_kind
  ON enrollment_intake_observations(enrollment_id, kind);

CREATE INDEX IF NOT EXISTS enrollment_intake_observations_enrollment_idx
  ON enrollment_intake_observations(enrollment_id, observed_at);
