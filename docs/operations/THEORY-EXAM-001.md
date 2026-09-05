# THEORY-EXAM-001 — Theory Exam Attempts

## Purpose

Represent theory-exam history without collapsing scheduling, attendance, observed result and official result into the `THEORY_PASSED` milestone.

The domain owns attempts. PROCESS only advances after official approval.

```text
THEORY_PASSED frontier
        ↓
TheoryExamAttempt
        ↓
attendance
        ↓
observed result
        ↓
official reconciliation
        ↓
APPROVED -> THEORY_PASSED achieved
FAILED   -> frontier remains THEORY_PASSED
ABSENT   -> frontier remains THEORY_PASSED
```

## Durable state

Migration `0011_theory_exam_attempts.sql` adds `theory_exam_attempts`.

An attempt records:

- Enrollment + Student;
- scheduled time;
- booking source;
- optional protocol;
- attendance;
- observed result;
- official result;
- terminal `resolved_at`.

One Enrollment may have many historical attempts but at most one unresolved attempt.

## Authority

`THEORY-EXAM-001` is first-license only in this cut.

A new attempt requires:

- active Student;
- active Enrollment;
- `REGISTRATION_DONE` achieved;
- `HEALTH_DONE` achieved;
- `THEORY_PASSED` not yet achieved.

That makes `THEORY_PASSED` the institutional frontier without introducing `current_step`.

## Scheduling reconciliation

Creating or rescheduling an attempt mirrors its scheduled time into the existing `THEORY_PASSED.scheduled_for` projection so existing Process/Student/Today views remain coherent.

The attempt remains the richer operational evidence.

## Resolution law

- `PRESENT` is required before an observed result.
- observed result is required before an official result.
- `ABSENT` resolves the attempt without fabricating a failed official result.
- official `FAILED` resolves the attempt and clears the current milestone schedule so another attempt may be created.
- official `APPROVED` resolves the attempt and atomically achieves `THEORY_PASSED`.
- official reconciliation is immutable in this cut.

## Staff API

```text
GET  /api/admin/theory-exams?enrollmentId=:id
POST /api/admin/theory-exams
GET  /api/admin/theory-exams/:id
POST /api/admin/theory-exams/:id/reschedule
POST /api/admin/theory-exams/:id/attendance
POST /api/admin/theory-exams/:id/observed-result
POST /api/admin/theory-exams/:id/official-result
```

All mutations require Staff authority and the existing Origin boundary.

## Audit

The domain emits:

- `THEORY_EXAM_ATTEMPT_CREATED`;
- `THEORY_EXAM_ATTEMPT_RESCHEDULED`;
- `THEORY_EXAM_ATTENDANCE_RECORDED`;
- `THEORY_EXAM_RESULT_OBSERVED`;
- `THEORY_EXAM_RESULT_RECONCILED`;
- process schedule/achievement audit when the attempt changes the process projection.

## Witness

`server/http/admin-theory-exams.test.ts` proves over PostgreSQL + HTTP:

- anonymous rejection;
- Origin gate;
- first-license frontier requirement;
- one unresolved attempt at a time;
- schedule projection into PROCESS;
- failed attempt preserved while process stays on theory;
- absence preserved without fake official failure;
- a later attempt can be created;
- only official approval advances to `PRACTICE_DONE`;
- full attempt history and audit persist.

## Non-goals

- DETRAN integration;
- automatic polling of results;
- non-first-license theory models;
- Student-originated result mutation;
- deleting or rewriting resolved attempts;
- turning PROCESS-OPS into mutation authority.
