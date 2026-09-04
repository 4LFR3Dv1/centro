-- PROCESS-001 / C1 — institutional milestone facts.
-- Process state is derived from Enrollment + these facts + Lesson evidence.
-- There is deliberately no mutable `current_step` column.

CREATE TABLE enrollment_milestones (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  code text NOT NULL,
  scheduled_for timestamptz,
  achieved_at timestamptz,
  achieved_by_staff_user_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
  updated_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollment_milestones_code_valid CHECK (
    code IN (
      'REGISTRATION_DONE',
      'HEALTH_DONE',
      'THEORY_PASSED',
      'PRACTICE_DONE',
      'PRACTICAL_EXAM_PASSED',
      'LICENSE_AVAILABLE'
    )
  ),
  CONSTRAINT enrollment_milestones_achievement_actor_consistent CHECK (
    (achieved_at IS NULL AND achieved_by_staff_user_id IS NULL)
    OR
    (achieved_at IS NOT NULL AND achieved_by_staff_user_id IS NOT NULL)
  ),
  CONSTRAINT enrollment_milestones_note_nonempty CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE UNIQUE INDEX enrollment_milestones_enrollment_code_unique
  ON enrollment_milestones(enrollment_id, code);

CREATE INDEX enrollment_milestones_enrollment_idx
  ON enrollment_milestones(enrollment_id, achieved_at, scheduled_for);

CREATE INDEX enrollment_milestones_upcoming_idx
  ON enrollment_milestones(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND achieved_at IS NULL;
