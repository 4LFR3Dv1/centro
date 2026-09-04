-- ACCESS-001 — Persistent Student Access QR
-- QR is an identity locator, never an authentication credential.
-- One active QR per Student; historical revoked QRs remain resolvable by Staff.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE student_access_qrs (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  public_token text NOT NULL UNIQUE,
  rotated_from_id uuid REFERENCES student_access_qrs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT student_access_qrs_token_nonempty CHECK (btrim(public_token) <> ''),
  CONSTRAINT student_access_qrs_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX student_access_qrs_one_active_per_student
  ON student_access_qrs(student_id)
  WHERE revoked_at IS NULL;

CREATE INDEX student_access_qrs_student_history_idx
  ON student_access_qrs(student_id, created_at DESC);

-- Existing students receive one persistent access QR during migration.
INSERT INTO student_access_qrs(id, student_id, public_token)
SELECT gen_random_uuid(), s.id, replace(gen_random_uuid()::text, '-', '')
FROM students s
WHERE NOT EXISTS (
  SELECT 1
  FROM student_access_qrs q
  WHERE q.student_id = s.id AND q.revoked_at IS NULL
);
