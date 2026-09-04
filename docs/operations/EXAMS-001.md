# EXAMS-001 — Practical Exam Operational Roster

## Purpose

`EXAMS-001` materializes the school's operational roster for practical driving exams without turning the official process into generic CRUD.

The operational object is separate from the process fact:

```text
PracticalExamSession
  -> PracticalExamCandidate
  -> observed result
  -> official reconciliation
  -> EnrollmentMilestone(PRACTICAL_EXAM_PASSED)
```

`PRACTICAL_EXAM_PASSED` remains an institutional fact. A roster is logistics around that fact.

## Staff surface

- `/admin/exames`
- Staff session required for every API read/write.
- Mutations require the configured public Origin.
- CPF/document is never a login identifier and is projected masked in the roster.

## Session

A `PracticalExamSession` owns:

- physical category (`A`, `B`, `D`)
- location/banca label
- operational start/end window
- responsible instructor
- vehicle
- state (`PLANNED`, `CONFIRMED`, `CLOSED`, `CANCELLED`)

Instructor and vehicle are reserved for the full session window.

### Conflicts

The database rejects:

- overlapping open exam sessions for the same instructor
- overlapping open exam sessions for the same vehicle
- an exam session that overlaps a scheduled lesson for its instructor
- an exam session that overlaps a scheduled lesson for its vehicle
- a later scheduled lesson that overlaps a reserved exam instructor/vehicle
- a later scheduled lesson containing a candidate's official exam time

The conflict law is bidirectional between `Lesson` and `PracticalExamSession`.

## Candidate

A `PracticalExamCandidate` owns:

- Enrollment/Student identity
- official scheduled time
- booking source (`SELF`, `SCHOOL`)
- optional protocol
- optional RENACH
- fee check (`UNKNOWN`, `PENDING`, `PAID`)
- LADV check (`UNKNOWN`, `READY`)
- attendance (`PENDING`, `PRESENT`, `ABSENT`)
- observed result (`PENDING`, `APPROVED`, `FAILED`)
- official result (`PENDING`, `APPROVED`, `FAILED`)

Candidates are always projected in `official_scheduled_for ASC` order.

### Eligibility

The kernel requires:

- active Student
- active Enrollment
- category compatible with the roster (`AB` may enter `A` or `B`)
- no already-achieved `PRACTICAL_EXAM_PASSED`
- only one open practical-exam roster per Enrollment
- official time inside the session window
- no scheduled lesson containing the official exam time
- for `FIRST_LICENSE`, `PRACTICE_DONE` must already be achieved

When a candidate enters a roster, the existing `PRACTICAL_EXAM_PASSED` milestone receives/updates `scheduled_for`. This preserves the existing Admin Today/process projections without making the milestone the roster itself.

## Result law

The school records two layers:

```text
observed_result
    !=
official_result
```

Observed result is operational information from the exam day. It does not advance the process.

Official reconciliation requires:

1. attendance = `PRESENT`
2. observed result recorded
3. official result still `PENDING`

An official `APPROVED` result materializes `PRACTICAL_EXAM_PASSED` as achieved. For `FIRST_LICENSE`, the process resolver must prove that `PRACTICAL_EXAM_PASSED` is the current derived frontier before the approval can advance the process.

Official reconciliation is immutable in this cut. Corrections require a future explicit correction primitive rather than silently rewriting history.

## Session transitions

```text
PLANNED -> CONFIRMED -> CLOSED
    \          \
     -> CANCELLED
```

- Confirmation requires at least one candidate.
- Closing requires attendance resolved for everyone and official results resolved for present candidates.
- A roster with any reconciled official result cannot be cancelled.

## Audit

Operational mutations emit AuditEvent facts including:

- `EXAM_SESSION_CREATED`
- `EXAM_SESSION_STATUS_CHANGED`
- `EXAM_CANDIDATE_ADDED`
- `EXAM_CANDIDATE_UPDATED`
- `EXAM_CANDIDATE_REMOVED`
- `EXAM_ATTENDANCE_RECORDED`
- `EXAM_RESULT_OBSERVED`
- `EXAM_RESULT_RECONCILED`
- `PROCESS_MILESTONE_ACHIEVED` when official approval advances the process

## Explicit non-goals

`EXAMS-001` does not:

- integrate directly with Detran/Poupatempo
- claim the school's observed result is the official result
- model an examiner as the school's instructor
- reorder candidates independently of their official scheduled time
- persist plaintext credentials or use CPF as authentication
