-- THEORY-EXAM-001 — Theory exam attempts as durable institutional evidence.
-- Scheduling/result history lives here. THEORETICAL approval advances PROCESS only after official reconciliation.

CREATE TABLE theory_exam_attempts (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  booking_source text NOT NULL DEFAULT 'SCHOOL',
  protocol text,
  attendance_status text NOT NULL DEFAULT 'PENDING',
  observed_result text NOT NULL DEFAULT 'PENDING',
  official_result text NOT NULL DEFAULT 'PENDING',
  resolved_at timestamptz,
  created_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  updated_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theory_exam_attempts_enrollment_student_fk
    FOREIGN KEY (enrollment_id, student_id)
    REFERENCES enrollments(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT theory_exam_attempts_booking_source_valid CHECK (booking_source IN ('SELF', 'SCHOOL')),
  CONSTRAINT theory_exam_attempts_attendance_valid CHECK (attendance_status IN ('PENDING', 'PRESENT', 'ABSENT')),
  CONSTRAINT theory_exam_attempts_observed_result_valid CHECK (observed_result IN ('PENDING', 'APPROVED', 'FAILED')),
  CONSTRAINT theory_exam_attempts_official_result_valid CHECK (official_result IN ('PENDING', 'APPROVED', 'FAILED')),
  CONSTRAINT theory_exam_attempts_protocol_nonempty CHECK (protocol IS NULL OR btrim(protocol) <> ''),
  CONSTRAINT theory_exam_attempts_resolution_consistent CHECK (
    (
      resolved_at IS NULL
      AND official_result = 'PENDING'
      AND attendance_status <> 'ABSENT'
    )
    OR
    (
      resolved_at IS NOT NULL
      AND (
        (attendance_status = 'ABSENT' AND observed_result = 'PENDING' AND official_result = 'PENDING')
        OR
        (attendance_status = 'PRESENT' AND observed_result <> 'PENDING' AND official_result <> 'PENDING')
      )
    )
  )
);

CREATE UNIQUE INDEX theory_exam_attempts_one_open_per_enrollment
  ON theory_exam_attempts(enrollment_id)
  WHERE resolved_at IS NULL;

CREATE INDEX theory_exam_attempts_enrollment_history_idx
  ON theory_exam_attempts(enrollment_id, scheduled_for DESC, created_at DESC);

CREATE INDEX theory_exam_attempts_open_schedule_idx
  ON theory_exam_attempts(scheduled_for)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION enforce_theory_exam_attempt_kernel() RETURNS trigger AS $$
DECLARE
  enrollment_service_type text;
  enrollment_status text;
  student_status text;
  registration_done boolean;
  health_done boolean;
  theory_done boolean;
BEGIN
  SELECT e.service_type, e.status, s.status,
         EXISTS (
           SELECT 1 FROM enrollment_milestones m
           WHERE m.enrollment_id = e.id AND m.code = 'REGISTRATION_DONE' AND m.achieved_at IS NOT NULL
         ),
         EXISTS (
           SELECT 1 FROM enrollment_milestones m
           WHERE m.enrollment_id = e.id AND m.code = 'HEALTH_DONE' AND m.achieved_at IS NOT NULL
         ),
         EXISTS (
           SELECT 1 FROM enrollment_milestones m
           WHERE m.enrollment_id = e.id AND m.code = 'THEORY_PASSED' AND m.achieved_at IS NOT NULL
         )
    INTO enrollment_service_type, enrollment_status, student_status, registration_done, health_done, theory_done
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  WHERE e.id = NEW.enrollment_id AND e.student_id = NEW.student_id;

  IF enrollment_service_type IS NULL OR enrollment_status <> 'ACTIVE' OR student_status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'theory_exam_attempt_active_enrollment_required',
      MESSAGE = 'Theory exam attempt requires an active Student and active Enrollment.';
  END IF;

  IF enrollment_service_type <> 'FIRST_LICENSE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'theory_exam_attempt_first_license_required',
      MESSAGE = 'THEORY-EXAM-001 models first-license attempts only.';
  END IF;

  IF registration_done IS DISTINCT FROM true OR health_done IS DISTINCT FROM true OR theory_done IS DISTINCT FROM false THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'theory_exam_attempt_frontier_required',
      MESSAGE = 'Theory exam attempt requires THEORY_PASSED to be the current institutional frontier.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER theory_exam_attempt_kernel_guard
BEFORE INSERT OR UPDATE OF enrollment_id, student_id, scheduled_for, attendance_status, observed_result, official_result, resolved_at
ON theory_exam_attempts
FOR EACH ROW
EXECUTE FUNCTION enforce_theory_exam_attempt_kernel();
