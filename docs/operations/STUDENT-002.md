# STUDENT-002 — Student Calendar

Status: candidate

Program ledger: #26

## Purpose

Project the same `Lesson` facts admitted for the school calendar into the authenticated Student portal.

STUDENT-002 creates no second scheduling domain and grants the Student no scheduling mutation authority.

## Authority

A Student session may read only Lessons whose `student_id` matches the authenticated Student.

Before the mandatory initial password rotation is complete, calendar access is denied. The authentication/session endpoint remains available so the first-access transition can complete.

A Student cannot:

- create a Lesson;
- reschedule a Lesson;
- complete a Lesson;
- mark a no-show;
- cancel a Lesson;
- select Instructor or Vehicle.

Those commands remain Staff authority in SCHEDULE-002.

## API

### Calendar

`GET /api/student/calendar`

Returns two bounded projections:

- `upcoming`: scheduled Lessons whose end is not in the past, ordered ascending;
- `past`: resolved or elapsed Lessons, ordered descending.

The projection contains only Student-appropriate facts:

- Lesson identity;
- Enrollment identity;
- category;
- start/end timestamps;
- status;
- Instructor display name;
- Vehicle label;
- operational note when present.

Vehicle plate, Staff identity and internal conflict state are not projected.

### Lesson detail

`GET /api/student/lessons/:id`

The Lesson is resolved under both its ID and the authenticated `student_id`. A Lesson belonging to another Student is returned as `404`, preventing existence disclosure across Student identities.

## UI

`/aluno/agenda`

Provides:

- upcoming lessons;
- past lessons;
- status;
- Instructor;
- Vehicle label;
- category;
- links to Lesson detail.

`/aluno/agenda/:id`

Provides the detail projection for one authorized Lesson.

The Student top navigation now contains `Início` and `Agenda` after the mandatory first-password transition.

## Shared-state law

The school and Student do not synchronize calendars. They read the same `lessons` records.

A SCHEDULE-002 Staff mutation therefore becomes visible in the Student projection without a copy, confirmation event or second state machine.

## Explicit non-goals

STUDENT-002 does not materialize:

- process/milestone state;
- next process action;
- documents/guides;
- lesson confirmation by Student;
- Student-originated rescheduling;
- password settings beyond the already admitted first-access transition.

## Witness

`server/http/student-calendar.test.ts` proves with real PostgreSQL + HTTP:

1. anonymous calendar access is rejected;
2. a first-access Student cannot bypass password rotation to view the calendar;
3. after rotation the Student can read the calendar;
4. a future Lesson is projected as upcoming;
5. a completed historical Lesson is projected as past;
6. Instructor/Vehicle/notes are projected;
7. another Student's Lesson never appears in the calendar;
8. authorized Lesson detail resolves;
9. another Student's Lesson detail returns `404`.

CI keeps all inherited ADMIN/STUDENT/SCHEDULE witnesses and requires `/aluno/agenda` in production-image smoke while anonymous `/api/student/calendar` remains `401`.
