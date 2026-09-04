-- EXAMS-001 / C1 — Practical Exam Operational Roster
-- The roster is operational state. Process completion remains derived from institutional milestones.
-- Instructor/vehicle conflicts are enforced against both exam sessions and lessons.

CREATE TABLE practical_exam_sessions (
  id uuid PRIMARY KEY,
  category text NOT NULL,
  location_label text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  instructor_id uuid NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PLANNED',
  notes text,
  created_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practical_exam_sessions_category_valid CHECK (category IN ('A', 'B', 'D')),
  CONSTRAINT practical_exam_sessions_location_nonempty CHECK (btrim(location_label) <> ''),
  CONSTRAINT practical_exam_sessions_window_positive CHECK (ends_at > starts_at),
  CONSTRAINT practical_exam_sessions_status_valid CHECK (status IN ('PLANNED', 'CONFIRMED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT practical_exam_sessions_notes_nonempty CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE INDEX practical_exam_sessions_time_idx ON practical_exam_sessions(starts_at, ends_at);
CREATE INDEX practical_exam_sessions_status_time_idx ON practical_exam_sessions(status, starts_at);

ALTER TABLE practical_exam_sessions ADD CONSTRAINT practical_exam_sessions_no_instructor_overlap
  EXCLUDE USING gist (
    instructor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('PLANNED', 'CONFIRMED'));

ALTER TABLE practical_exam_sessions ADD CONSTRAINT practical_exam_sessions_no_vehicle_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('PLANNED', 'CONFIRMED'));

CREATE TABLE practical_exam_candidates (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES practical_exam_sessions(id) ON DELETE RESTRICT,
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  official_scheduled_for timestamptz NOT NULL,
  booking_source text NOT NULL DEFAULT 'SCHOOL',
  protocol text,
  renach text,
  fee_status text NOT NULL DEFAULT 'UNKNOWN',
  ladv_status text NOT NULL DEFAULT 'UNKNOWN',
  attendance_status text NOT NULL DEFAULT 'PENDING',
  observed_result text NOT NULL DEFAULT 'PENDING',
  official_result text NOT NULL DEFAULT 'PENDING',
  result_reconciled_at timestamptz,
  created_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practical_exam_candidates_enrollment_student_fk
    FOREIGN KEY (enrollment_id, student_id)
    REFERENCES enrollments(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT practical_exam_candidates_booking_source_valid CHECK (booking_source IN ('SELF', 'SCHOOL')),
  CONSTRAINT practical_exam_candidates_fee_status_valid CHECK (fee_status IN ('UNKNOWN', 'PENDING', 'PAID')),
  CONSTRAINT practical_exam_candidates_ladv_status_valid CHECK (ladv_status IN ('UNKNOWN', 'READY')),
  CONSTRAINT practical_exam_candidates_attendance_valid CHECK (attendance_status IN ('PENDING', 'PRESENT', 'ABSENT')),
  CONSTRAINT practical_exam_candidates_observed_result_valid CHECK (observed_result IN ('PENDING', 'APPROVED', 'FAILED')),
  CONSTRAINT practical_exam_candidates_official_result_valid CHECK (official_result IN ('PENDING', 'APPROVED', 'FAILED')),
  CONSTRAINT practical_exam_candidates_protocol_nonempty CHECK (protocol IS NULL OR btrim(protocol) <> ''),
  CONSTRAINT practical_exam_candidates_renach_nonempty CHECK (renach IS NULL OR btrim(renach) <> ''),
  CONSTRAINT practical_exam_candidates_result_reconciliation_consistent CHECK (
    (official_result = 'PENDING' AND result_reconciled_at IS NULL)
    OR (official_result <> 'PENDING' AND result_reconciled_at IS NOT NULL)
  ),
  UNIQUE (session_id, enrollment_id)
);

CREATE INDEX practical_exam_candidates_session_time_idx
  ON practical_exam_candidates(session_id, official_scheduled_for);
CREATE INDEX practical_exam_candidates_enrollment_idx
  ON practical_exam_candidates(enrollment_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_practical_exam_session_kernel() RETURNS trigger AS $$
DECLARE
  instructor_active boolean;
  instructor_authorized boolean;
  vehicle_active boolean;
  vehicle_category text;
BEGIN
  SELECT i.active,
         EXISTS (
           SELECT 1 FROM instructor_categories ic
           WHERE ic.instructor_id = i.id AND ic.category = NEW.category
         )
    INTO instructor_active, instructor_authorized
  FROM instructors i
  WHERE i.id = NEW.instructor_id;

  IF instructor_active IS DISTINCT FROM true OR instructor_authorized IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_session_instructor_authorized',
      MESSAGE = 'Practical exam session requires an active Instructor authorized for the category.';
  END IF;

  SELECT v.active, v.category
    INTO vehicle_active, vehicle_category
  FROM vehicles v
  WHERE v.id = NEW.vehicle_id;

  IF vehicle_active IS DISTINCT FROM true OR vehicle_category IS DISTINCT FROM NEW.category THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_session_vehicle_compatible',
      MESSAGE = 'Practical exam session requires an active Vehicle in the session category.';
  END IF;

  IF NEW.status IN ('PLANNED', 'CONFIRMED') AND EXISTS (
    SELECT 1 FROM lessons l
    WHERE l.status = 'SCHEDULED'
      AND l.instructor_id = NEW.instructor_id
      AND tstzrange(l.starts_at, l.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_session_instructor_lesson_conflict',
      MESSAGE = 'Instructor has a scheduled lesson during the practical exam session.';
  END IF;

  IF NEW.status IN ('PLANNED', 'CONFIRMED') AND EXISTS (
    SELECT 1 FROM lessons l
    WHERE l.status = 'SCHEDULED'
      AND l.vehicle_id = NEW.vehicle_id
      AND tstzrange(l.starts_at, l.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_session_vehicle_lesson_conflict',
      MESSAGE = 'Vehicle has a scheduled lesson during the practical exam session.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER practical_exam_session_kernel_guard
BEFORE INSERT OR UPDATE OF category, starts_at, ends_at, instructor_id, vehicle_id, status
ON practical_exam_sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_practical_exam_session_kernel();

CREATE OR REPLACE FUNCTION enforce_practical_exam_candidate_kernel() RETURNS trigger AS $$
DECLARE
  session_category text;
  session_start timestamptz;
  session_end timestamptz;
  session_status text;
  enrollment_category text;
  enrollment_service_type text;
  enrollment_status text;
  student_status text;
BEGIN
  SELECT category, starts_at, ends_at, status
    INTO session_category, session_start, session_end, session_status
  FROM practical_exam_sessions
  WHERE id = NEW.session_id;

  IF session_category IS NULL OR session_status NOT IN ('PLANNED', 'CONFIRMED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_open_session_required',
      MESSAGE = 'Candidate requires an open practical exam session.';
  END IF;

  IF NEW.official_scheduled_for < session_start OR NEW.official_scheduled_for >= session_end THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_inside_session_window',
      MESSAGE = 'Candidate official time must be inside the exam session window.';
  END IF;

  SELECT e.category, e.service_type, e.status, s.status
    INTO enrollment_category, enrollment_service_type, enrollment_status, student_status
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  WHERE e.id = NEW.enrollment_id AND e.student_id = NEW.student_id;

  IF enrollment_category IS NULL OR enrollment_status <> 'ACTIVE' OR student_status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_active_enrollment_required',
      MESSAGE = 'Candidate requires an active Student and active Enrollment.';
  END IF;

  IF NOT (
    (enrollment_category = 'AB' AND session_category IN ('A', 'B'))
    OR enrollment_category = session_category
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_category_compatible',
      MESSAGE = 'Candidate Enrollment category is incompatible with the exam session.';
  END IF;

  IF enrollment_service_type = 'FIRST_LICENSE' AND NOT EXISTS (
    SELECT 1 FROM enrollment_milestones m
    WHERE m.enrollment_id = NEW.enrollment_id
      AND m.code = 'PRACTICE_DONE'
      AND m.achieved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_practice_done_required',
      MESSAGE = 'First-license candidate requires PRACTICE_DONE before practical exam.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM enrollment_milestones m
    WHERE m.enrollment_id = NEW.enrollment_id
      AND m.code = 'PRACTICAL_EXAM_PASSED'
      AND m.achieved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_not_already_approved',
      MESSAGE = 'Candidate already has a confirmed practical exam approval.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM lessons l
    WHERE l.student_id = NEW.student_id
      AND l.status = 'SCHEDULED'
      AND l.starts_at <= NEW.official_scheduled_for
      AND l.ends_at > NEW.official_scheduled_for
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_student_lesson_conflict',
      MESSAGE = 'Candidate has a scheduled lesson at the official exam time.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM practical_exam_candidates c
    JOIN practical_exam_sessions s ON s.id = c.session_id
    WHERE c.enrollment_id = NEW.enrollment_id
      AND c.id <> NEW.id
      AND c.official_result = 'PENDING'
      AND s.status IN ('PLANNED', 'CONFIRMED')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'practical_exam_candidate_single_open_roster',
      MESSAGE = 'Enrollment already belongs to another open practical exam roster.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER practical_exam_candidate_kernel_guard
BEFORE INSERT OR UPDATE OF session_id, enrollment_id, student_id, official_scheduled_for
ON practical_exam_candidates
FOR EACH ROW
EXECUTE FUNCTION enforce_practical_exam_candidate_kernel();

CREATE OR REPLACE FUNCTION enforce_lesson_practical_exam_conflicts() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'SCHEDULED' AND EXISTS (
    SELECT 1 FROM practical_exam_sessions s
    WHERE s.status IN ('PLANNED', 'CONFIRMED')
      AND s.instructor_id = NEW.instructor_id
      AND tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_instructor_practical_exam_conflict',
      MESSAGE = 'Instructor is reserved by a practical exam session.';
  END IF;

  IF NEW.status = 'SCHEDULED' AND EXISTS (
    SELECT 1 FROM practical_exam_sessions s
    WHERE s.status IN ('PLANNED', 'CONFIRMED')
      AND s.vehicle_id = NEW.vehicle_id
      AND tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_vehicle_practical_exam_conflict',
      MESSAGE = 'Vehicle is reserved by a practical exam session.';
  END IF;

  IF NEW.status = 'SCHEDULED' AND EXISTS (
    SELECT 1
    FROM practical_exam_candidates c
    JOIN practical_exam_sessions s ON s.id = c.session_id
    WHERE c.student_id = NEW.student_id
      AND c.official_result = 'PENDING'
      AND s.status IN ('PLANNED', 'CONFIRMED')
      AND c.official_scheduled_for >= NEW.starts_at
      AND c.official_scheduled_for < NEW.ends_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_student_practical_exam_conflict',
      MESSAGE = 'Student has a practical exam during the lesson window.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lessons_practical_exam_conflict_guard
BEFORE INSERT OR UPDATE OF student_id, instructor_id, vehicle_id, starts_at, ends_at, status
ON lessons
FOR EACH ROW
EXECUTE FUNCTION enforce_lesson_practical_exam_conflicts();
