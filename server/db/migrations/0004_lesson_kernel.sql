-- SCHEDULE-001 / C1 — Lesson Kernel
-- One agenda domain for both school and student projections.
-- SCHEDULE-002 owns calendar mutations/UI; this migration owns the physical laws.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_id_student_unique UNIQUE (id, student_id);

CREATE TABLE instructors (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instructors_display_name_nonempty CHECK (btrim(display_name) <> '')
);

CREATE TABLE instructor_categories (
  instructor_id uuid NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instructor_id, category),
  CONSTRAINT instructor_categories_category_valid CHECK (category IN ('A', 'B', 'D'))
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY,
  plate text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_plate_nonempty CHECK (btrim(plate) <> ''),
  CONSTRAINT vehicles_label_nonempty CHECK (btrim(label) <> ''),
  CONSTRAINT vehicles_category_valid CHECK (category IN ('A', 'B', 'D'))
);

CREATE UNIQUE INDEX vehicles_plate_unique_ci ON vehicles ((upper(btrim(plate))));
CREATE INDEX vehicles_active_category_idx ON vehicles(category) WHERE active = true;

CREATE TABLE schedule_policies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  slot_minutes integer NOT NULL DEFAULT 30,
  lesson_min_minutes integer NOT NULL DEFAULT 30,
  lesson_max_minutes integer NOT NULL DEFAULT 120,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_policies_name_nonempty CHECK (btrim(name) <> ''),
  CONSTRAINT schedule_policies_timezone_nonempty CHECK (btrim(timezone) <> ''),
  CONSTRAINT schedule_policies_slot_range CHECK (slot_minutes BETWEEN 5 AND 120),
  CONSTRAINT schedule_policies_min_range CHECK (lesson_min_minutes BETWEEN 10 AND 240),
  CONSTRAINT schedule_policies_max_range CHECK (
    lesson_max_minutes >= lesson_min_minutes AND lesson_max_minutes <= 480
  )
);

CREATE UNIQUE INDEX schedule_policies_one_active_idx
  ON schedule_policies(active)
  WHERE active = true;

CREATE TABLE lessons (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  instructor_id uuid NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  category text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  resolved_at timestamptz,
  notes text,
  created_by_staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessons_enrollment_student_fk
    FOREIGN KEY (enrollment_id, student_id)
    REFERENCES enrollments(id, student_id)
    ON DELETE RESTRICT,
  CONSTRAINT lessons_category_valid CHECK (category IN ('A', 'B', 'D')),
  CONSTRAINT lessons_status_valid CHECK (status IN ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
  CONSTRAINT lessons_window_positive CHECK (ends_at > starts_at),
  CONSTRAINT lessons_resolution_consistent CHECK (
    (status = 'SCHEDULED' AND resolved_at IS NULL)
    OR
    (status <> 'SCHEDULED' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX lessons_student_time_idx ON lessons(student_id, starts_at);
CREATE INDEX lessons_instructor_time_idx ON lessons(instructor_id, starts_at);
CREATE INDEX lessons_vehicle_time_idx ON lessons(vehicle_id, starts_at);
CREATE INDEX lessons_status_time_idx ON lessons(status, starts_at);

ALTER TABLE lessons ADD CONSTRAINT lessons_no_student_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'SCHEDULED');

ALTER TABLE lessons ADD CONSTRAINT lessons_no_instructor_overlap
  EXCLUDE USING gist (
    instructor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'SCHEDULED');

ALTER TABLE lessons ADD CONSTRAINT lessons_no_vehicle_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'SCHEDULED');

CREATE OR REPLACE FUNCTION enforce_lesson_kernel() RETURNS trigger AS $$
DECLARE
  enrollment_category text;
  enrollment_status text;
  student_status text;
  instructor_active boolean;
  instructor_authorized boolean;
  vehicle_active boolean;
  vehicle_category text;
BEGIN
  SELECT e.category, e.status, s.status
    INTO enrollment_category, enrollment_status, student_status
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  WHERE e.id = NEW.enrollment_id AND e.student_id = NEW.student_id;

  IF enrollment_category IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_enrollment_student_required',
      MESSAGE = 'Lesson requires a valid Enrollment/Student pair.';
  END IF;

  IF enrollment_status <> 'ACTIVE' OR student_status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_active_student_enrollment_required',
      MESSAGE = 'Lesson requires an active Student and active Enrollment.';
  END IF;

  IF NOT (
    (enrollment_category = 'AB' AND NEW.category IN ('A', 'B'))
    OR enrollment_category = NEW.category
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_enrollment_category_compatible',
      MESSAGE = 'Lesson category is incompatible with Enrollment category.';
  END IF;

  SELECT i.active,
         EXISTS (
           SELECT 1
           FROM instructor_categories ic
           WHERE ic.instructor_id = i.id AND ic.category = NEW.category
         )
    INTO instructor_active, instructor_authorized
  FROM instructors i
  WHERE i.id = NEW.instructor_id;

  IF instructor_active IS DISTINCT FROM true OR instructor_authorized IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_instructor_category_authorized',
      MESSAGE = 'Lesson requires an active Instructor authorized for the category.';
  END IF;

  SELECT v.active, v.category
    INTO vehicle_active, vehicle_category
  FROM vehicles v
  WHERE v.id = NEW.vehicle_id;

  IF vehicle_active IS DISTINCT FROM true OR vehicle_category IS DISTINCT FROM NEW.category THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'lessons_vehicle_category_compatible',
      MESSAGE = 'Lesson requires an active Vehicle in the lesson category.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lessons_kernel_guard
BEFORE INSERT OR UPDATE OF enrollment_id, student_id, instructor_id, vehicle_id, category
ON lessons
FOR EACH ROW
EXECUTE FUNCTION enforce_lesson_kernel();
