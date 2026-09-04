-- DOCS-001 / C1 — durable Student Guide generations.
-- Each row is a versioned snapshot/receipt. Generated content is never a credential surface.

CREATE TABLE student_guides (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  content_sha256 char(64) NOT NULL,
  generated_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_guides_enrollment_student_fk
    FOREIGN KEY (enrollment_id, student_id)
    REFERENCES enrollments(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT student_guides_template_id_nonempty CHECK (btrim(template_id) <> ''),
  CONSTRAINT student_guides_template_version_positive CHECK (template_version > 0),
  CONSTRAINT student_guides_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT student_guides_digest_format CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX student_guides_student_generated_idx
  ON student_guides(student_id, generated_at DESC);

CREATE INDEX student_guides_enrollment_generated_idx
  ON student_guides(enrollment_id, generated_at DESC);
