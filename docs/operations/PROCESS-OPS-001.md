# PROCESS-OPS-001 — Operational Guidance

## Goal

Turn the existing Student Workspace from a historical/process view into a school cockpit that answers one operational question first:

> What needs to happen now with this student?

This cut does not create a second process engine. `server/process/resolver.ts` remains the authority for process state. `PROCESS-OPS-001` is a School projection over that accepted state.

`STUDENT-DETAIL-002` is an accepted dependency on `main`; this cut layers operational guidance over that institutional record.

Admission requires the complete operational CI gate, including PostgreSQL witnesses, frontend/server build, deployment image and runtime smoke.

## Existing primitives reused

The cut composes primitives already admitted by CENTRO-OPS:

- persistent `StudentAccessQr` as Student identity locator;
- Staff-only QR lookup;
- `Enrollment` and modern intake facts;
- `ProcessResolver` / institutional milestones;
- Lesson Kernel and schedule constraints;
- practical exam surfaces;
- AuditEvent continuity.

No `ProcessQr` is introduced. One Student QR can locate a person with multiple Enrollment processes over time.

## SchoolOperationalProjection

`resolveStudentOperationalContext(studentId)` resolves every ACTIVE/PAUSED process through the existing ProcessResolver and translates the derived state into a school-facing action.

The projection classifies actions as:

- `BLOCKING`
- `ACTION_REQUIRED`
- `SCHEDULED`
- `WAITING`
- `COMPLETE`

Examples:

- `REGISTRATION_DONE` -> school records completion of registration/biometrics when evidence exists;
- `HEALTH_DONE` -> school records the completed health assessments;
- `THEORY_PASSED` without date -> schedule theory exam;
- `PRACTICE_DONE` without a future Lesson -> schedule first/next practical lesson;
- `PRACTICE_DONE` with a future Lesson -> no immediate intervention; open calendar if needed;
- `PRACTICAL_EXAM_PASSED` -> organize/wait for practical exam depending on the current schedule;
- `LICENSE_AVAILABLE` -> wait for/record license availability through the process surface.

The projection never writes milestones itself.

## HTTP projection

Staff can read:

`GET /api/admin/process/students/:studentId/operations`

The endpoint is Staff-authenticated and only projects state already admitted by the underlying domains.

## Student workspace

`/admin/alunos/:id` now puts `O QUE PRECISA ACONTECER AGORA` immediately after the Student hero.

The QR flow therefore becomes:

`scan Student QR -> Staff lookup -> /admin/alunos/:id -> SchoolOperationalProjection -> primary action`

The existing QR remains a locator, never an authentication credential.

## Direct practical scheduling

When the derived action is `SCHEDULE_FIRST_LESSON` or `SCHEDULE_NEXT_LESSON`, the primary CTA opens a contextual scheduler inside the Student workspace.

The scheduler:

- is locked to the Enrollment selected by the ProcessResolver;
- uses the Enrollment category (A/B or a physical choice for AB);
- loads the accepted schedule policy;
- uses active authorized instructors and vehicles;
- writes through the existing `POST /api/admin/schedule/lessons` endpoint;
- therefore preserves overlap, enrollment, category, instructor and vehicle constraints;
- emits no process milestone directly.

After a successful Lesson write, the operational context is recomputed. A former `SCHEDULE_FIRST_LESSON` action becomes `LESSON_ALREADY_SCHEDULED` when the ProcessResolver observes the future Lesson.

## Witness

`server/admin/student-operations.test.ts` proves the vertical path:

1. modern Enrollment materializes at theory-approved intake;
2. the existing Student QR resolves the Student identity;
3. ProcessResolver derives `PRACTICE_DONE`;
4. School projection derives `SCHEDULE_FIRST_LESSON`;
5. Lesson Kernel admits a future practical lesson;
6. School projection recomputes to `LESSON_ALREADY_SCHEDULED`.

This proves that QR, process state and school action are composed without introducing `current_step` or a second workflow authority.
