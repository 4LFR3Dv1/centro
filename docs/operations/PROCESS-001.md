# PROCESS-001 — Milestone Engine

Status: candidate until CI and production-image smoke are green.

## Purpose

PROCESS-001 removes the last placeholder `current_step` idea from the operational platform.

The process shown to School and Student is always derived from durable facts:

```text
Enrollment
  + institutional milestone facts
  + Lesson evidence
        ↓
ProcessResolver
        ↓
School projection / Student projection / future documents and Today cockpit
```

There is no mutable `current_step` column.

## Public journey versus institutional process

The public `/cnh` explorer already uses a seven-stage first-license journey for an anonymous visitor:

1. process started;
2. registration/biometrics;
3. health assessments;
4. theory passed;
5. practice completed;
6. practical exam passed;
7. license available.

PROCESS-001 deliberately aligns its vocabulary with that journey, but **does not import or trust public `localStorage`**. `PUBLIC VISITOR != STUDENT` remains true.

The institutional codes are:

```text
PROCESS_STARTED              derived from Enrollment
REGISTRATION_DONE            admitted Staff milestone
HEALTH_DONE                  admitted Staff milestone
THEORY_PASSED                admitted Staff milestone
PRACTICE_DONE                admitted Staff milestone
PRACTICAL_EXAM_PASSED        admitted Staff milestone
LICENSE_AVAILABLE            admitted Staff milestone
```

Only `FIRST_LICENSE` is modeled in `FIRST_LICENSE_V1`. Other service types return `modeled=false`; the system refuses to fabricate a process sequence for them.

## Durable state

Migration `0005_process_milestones.sql` adds `enrollment_milestones`.

A stored milestone can contain:

- the Enrollment;
- institutional code;
- optional `scheduled_for`;
- optional `achieved_at`;
- Staff authority that achieved it;
- Staff authority that last updated it;
- optional note.

`PROCESS_STARTED` is never stored. It is derived from the Enrollment lifecycle.

There is one durable row per `(enrollment_id, code)`. Reverting a milestone clears the current achievement fact but does not erase the operational history because every mutation is preserved in `AuditEvent`.

## Linear frontier law

First-license milestones form one ordered frontier.

A Staff actor may only achieve the milestone that `ProcessResolver` currently derives as next. Skipping directly from registration to theory, for example, is rejected with conflict semantics.

Only the latest achieved institutional milestone may be reverted. This prevents a state such as “theory passed while health is no longer complete”.

Milestones advance only while the Enrollment is `ACTIVE`.

## Exam scheduling

PROCESS-001 can attach an expected time to the two exam-result milestones:

- `THEORY_PASSED`;
- `PRACTICAL_EXAM_PASSED`.

Scheduling does not imply achievement. The exam remains incomplete until Staff explicitly records the result milestone.

This distinction creates a factual source for the future `ADMIN-004` “upcoming exams” cockpit without inventing an Exam entity in this cut.

## Lesson evidence

Practical progress is derived from the accepted `Lesson` domain:

- completed lesson count;
- completed minutes;
- no-shows;
- scheduled lesson count;
- next future lesson.

Completing a Lesson therefore changes the process projection immediately.

Lesson evidence does **not** automatically achieve `PRACTICE_DONE`. Practice may include facts outside the Centro scheduler and regulatory requirements can vary; completion remains an explicit institutional milestone rather than a guessed threshold.

## Derived next action

The resolver emits a machine code, title and detail for the next action.

Examples:

```text
REGISTRATION_DONE -> COMPLETE_REGISTRATION
HEALTH_DONE       -> COMPLETE_HEALTH_ASSESSMENTS
THEORY_PASSED     -> SCHEDULE_THEORY_EXAM / ATTEND_THEORY_EXAM
PRACTICE_DONE     -> SCHEDULE_FIRST_LESSON / ATTEND_NEXT_LESSON / CONTINUE_PRACTICE
PRACTICAL_EXAM... -> SCHEDULE_PRACTICAL_EXAM / ATTEND_PRACTICAL_EXAM
LICENSE_AVAILABLE -> WAIT_FOR_LICENSE
all achieved      -> no next action
```

Paused and cancelled Enrollments receive lifecycle-specific next-action semantics instead of pretending the process is progressing.

## HTTP authority

PROCESS-001 owns these routes before the broad admin/student API handlers:

```text
GET  /api/admin/process/enrollments/:id
POST /api/admin/process/enrollments/:id/milestones/:code/achieve
POST /api/admin/process/enrollments/:id/milestones/:code/revoke
POST /api/admin/process/enrollments/:id/milestones/:code/schedule

GET  /api/student/process
```

Admin mutations require a valid Staff session and the existing POST Origin boundary.

Student projection requires a valid Student session and completion of the mandatory first-password rotation. The Student has no mutation authority over process milestones.

## Audit

Relevant Staff mutations emit:

```text
PROCESS_MILESTONE_SCHEDULED
PROCESS_MILESTONE_ACHIEVED
PROCESS_MILESTONE_REVOKED
```

The audited entity is the Enrollment.

## Surfaces

### School

The placeholder Process card in `/admin/alunos/:id` is replaced by the actual resolver projection. Staff can:

- see the current derived state;
- see all first-license milestones;
- see Lesson evidence during practice;
- schedule theory/practical exams when they are the current frontier;
- achieve the current milestone;
- revert only the latest achieved milestone.

### Student

The Student home now projects the derived current state and next action. `/aluno/processo` exposes the complete milestone path.

School and Student read the same Enrollment/milestone/Lesson state.

## Witness

`server/http/process-api.test.ts` uses real PostgreSQL and HTTP authority to prove:

- anonymous admin process access is rejected;
- Enrollment makes `PROCESS_STARTED` true without storing it;
- the first current state is registration;
- out-of-order achievement is rejected;
- registration and health advance linearly;
- theory exam scheduling changes next action without marking theory achieved;
- Student process access is blocked before mandatory password rotation;
- Student sees the same process after first-access completion;
- theory achievement advances to practice;
- a real completed Lesson reconciles completed count/minutes and next action;
- practical completion advances to practical exam;
- practical exam scheduling and achievement are distinct;
- license availability completes the process;
- reverting the frontier regresses the derived state;
- Staff schedule/achievement/revocation mutations persist AuditEvents.

All inherited ADMIN, STUDENT and SCHEDULE witnesses remain mandatory.

## Explicit non-goals

PROCESS-001 does not add:

- a process model for category addition/change or licensed training;
- arbitrary `current_step` mutation;
- automatic regulatory inference from lesson minutes;
- Student milestone mutation;
- Student Guide generation (`DOCS-001`);
- Today cockpit (`ADMIN-004`);
- Staff password settings/recovery.

Those boundaries remain separate cuts of issue #26.
