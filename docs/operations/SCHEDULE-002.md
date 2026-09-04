# SCHEDULE-002 — School Calendar

Status: candidate

Program ledger: #26

## Purpose

Project the single Lesson kernel admitted in SCHEDULE-001 into the school cockpit without duplicating scheduling state.

`/admin/agenda` is an operational view over `lessons`, `instructors`, `vehicles`, `schedule_policies`, `students` and `enrollments`.

## Authority

Only an authenticated Staff session can read or mutate the school calendar.

Every relevant mutation writes an `AuditEvent` under the authenticated Staff identity.

Public visitors and Student sessions receive no calendar mutation authority.

## Read model

`GET /api/admin/schedule/options`

Projects:

- active SchedulePolicy, or a non-persisted safe default;
- instructors and their category authorizations;
- vehicles and physical category;
- ACTIVE Enrollments for ACTIVE Students.

`GET /api/admin/schedule/lessons?from=&to=&instructorId=&vehicleId=`

Projects lessons intersecting a bounded period, optionally filtered by Instructor and Vehicle.

The HTTP query is capped at 32 days. Day and week UI views are projections over this same endpoint.

## Resource materialization

The calendar includes the minimum resource operations required to become usable from an empty schedule domain:

- create Instructor with explicit A/B/D authorizations;
- create Vehicle with one physical A/B/D category;
- activate a new SchedulePolicy while preserving previous policies as inactive history.

No password, credential or Student secret is projected into this surface.

## Lesson commands

### Schedule

`POST /api/admin/schedule/lessons`

Requires:

- ACTIVE Student;
- ACTIVE Enrollment belonging to that Student;
- physical Lesson category compatible with the Enrollment;
- active Instructor authorized for the category;
- active Vehicle in the same category;
- positive time window respecting active SchedulePolicy duration and slot rules.

### Reschedule

`POST /api/admin/schedule/lessons/:id/reschedule`

Only `SCHEDULED` Lessons may be remapped. The Enrollment/Student identity remains the same while time, category, Instructor, Vehicle and notes may change subject to all SCHEDULE-001 laws.

### Resolve

`POST /api/admin/schedule/lessons/:id/resolve`

Allowed terminal states:

- `COMPLETED`;
- `NO_SHOW`;
- `CANCELLED`.

A resolved Lesson cannot be resolved or rescheduled again by this primitive.

## Conflict law

SCHEDULE-002 does not implement a second conflict checker.

The PostgreSQL kernel remains authoritative:

- `lessons_no_student_overlap`;
- `lessons_no_instructor_overlap`;
- `lessons_no_vehicle_overlap`.

The API maps those physical rejections into operator-facing HTTP 409 responses. There is no arbitrary override path.

## Audit vocabulary

- `INSTRUCTOR_CREATED`
- `VEHICLE_CREATED`
- `SCHEDULE_POLICY_ACTIVATED`
- `LESSON_SCHEDULED`
- `LESSON_RESCHEDULED`
- `LESSON_COMPLETED`
- `LESSON_NO_SHOW`
- `LESSON_CANCELLED`

## UI

`/admin/agenda`

Provides:

- day view;
- week view;
- date navigation;
- Instructor filter;
- Vehicle filter;
- create Lesson;
- reschedule Lesson;
- conclude Lesson;
- mark no-show;
- cancel Lesson;
- resource setup for Instructor, Vehicle and SchedulePolicy.

The UI never fabricates availability. It proposes a command and the kernel admits or rejects it.

## Explicit non-goals

SCHEDULE-002 does not materialize:

- Student calendar projection;
- recurring availability generation;
- process/milestone advancement;
- exams;
- document generation;
- ADMIN-004 daily cockpit;
- password/security settings.

Those remain separate program cuts.

## Witness

`server/http/admin-schedule.test.ts` proves with real PostgreSQL + HTTP:

1. unauthenticated schedule access is rejected;
2. Staff can activate a policy;
3. Staff can create Instructor and Vehicle resources;
4. options project the active Enrollment and resources;
5. a Lesson can be scheduled;
6. conflicting Student time is rejected with HTTP 409;
7. the Lesson appears in the bounded calendar read model;
8. it can be rescheduled;
9. it can be completed;
10. a second Lesson can be marked `NO_SHOW`;
11. audit facts are persisted for the commands.

CI also keeps all inherited ADMIN, STUDENT and SCHEDULE-001 witnesses and requires the production image to resolve `/admin/agenda` while rejecting unauthenticated schedule API access.
