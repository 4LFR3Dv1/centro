# SCHEDULE-001 — Lesson Kernel

Status: CANDIDATE / awaiting CI.

Base authority: `ADMIN-003` accepted on `main` as `38d23e916b725df1a448e6723178da1f56cee7fb`.

## Purpose

Materialize the single scheduling domain shared by the school and Student projections without yet creating the School Calendar UI or scheduling mutation API.

The program law remains:

```text
/admin agenda  ─┐
                ├─ Lesson + SchedulePolicy
/aluno agenda  ─┘
```

`SCHEDULE-002` and `STUDENT-002` must project this state. They must not invent parallel calendar records.

## Physical primitives

### Instructor

- durable UUID identity;
- display name;
- active/inactive state;
- explicit category authorizations in `instructor_categories`;
- categories are physical lesson categories: `A`, `B`, `D`.

### Vehicle

- durable UUID identity;
- plate + human label;
- one physical category: `A`, `B`, or `D`;
- active/inactive state;
- normalized case-insensitive plate uniqueness.

### SchedulePolicy

Versionable scheduling policy with:

- timezone;
- slot duration;
- minimum lesson duration;
- maximum lesson duration;
- at most one active policy.

This cut materializes policy state only. `SCHEDULE-002` owns policy-aware calendar mutation behavior.

### Lesson

A Lesson is bound to:

- exactly one Enrollment;
- the Student that owns that Enrollment;
- exactly one Instructor;
- exactly one Vehicle;
- one physical category (`A`, `B`, `D`);
- a half-open time interval `[starts_at, ends_at)`;
- Staff authority that created the record.

Statuses:

```text
SCHEDULED
COMPLETED
NO_SHOW
CANCELLED
```

A resolved Lesson (`COMPLETED`, `NO_SHOW`, `CANCELLED`) must carry `resolved_at`; a `SCHEDULED` Lesson must not.

## Category law

Enrollment category is not identical to physical lesson category.

```text
Enrollment A  -> Lesson A
Enrollment B  -> Lesson B
Enrollment D  -> Lesson D
Enrollment AB -> Lesson A or B
```

No `AB` physical Vehicle or Lesson category exists.

The PostgreSQL kernel rejects:

- Lesson category incompatible with Enrollment;
- Instructor without explicit authorization for the Lesson category;
- inactive Instructor;
- Vehicle whose category differs from Lesson;
- inactive Vehicle;
- inactive Student or Enrollment;
- mismatched Enrollment/Student pair.

## Conflict law

For `SCHEDULED` Lessons, PostgreSQL exclusion constraints reject interval overlap for each of:

1. Student;
2. Instructor;
3. Vehicle.

Intervals are half-open, so an existing `12:00–13:00` Lesson permits a new Lesson beginning exactly at `13:00`.

Resolved/cancelled historical records do not occupy future scheduling capacity.

These are database laws, not UI validation hints.

## What this cut does not authorize

- `/admin/agenda`;
- create/reschedule/complete/no-show HTTP commands;
- calendar day/week views;
- Student calendar UI;
- recurring availability generation;
- arbitrary manual conflict override;
- process/milestone advancement.

Those belong to later program cuts, beginning with `SCHEDULE-002 — School Calendar`.

## Witnesses

`server/schedule/contracts.test.ts` proves the TypeScript category/window contracts.

`server/schedule/kernel.test.ts` runs against real PostgreSQL and proves:

- all four schedule primitives exist;
- migration `0004_lesson_kernel.sql` is admitted;
- only one active SchedulePolicy can exist;
- Student overlap is rejected;
- Instructor overlap is rejected;
- Vehicle overlap is rejected;
- adjacent Lessons are accepted;
- cancelled Lessons do not occupy capacity;
- Enrollment/Lesson category mismatch is rejected;
- Instructor/category mismatch is rejected;
- Vehicle/category mismatch is rejected;
- non-positive Lesson windows are rejected.

All inherited ADMIN/STUDENT witnesses remain in the same `ops:check` gate.

## Admission boundary

`SCHEDULE-001` is acceptable for `main` only after CI proves migrations, all inherited witnesses, the Lesson Kernel witnesses, frontend/server builds and deployment image smoke.
