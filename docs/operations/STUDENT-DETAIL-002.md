# STUDENT-DETAIL-002 — Institutional Student Record

## Goal

Reconcile `/admin/alunos/:id` with the facts admitted by `ENROLLMENT-002` without creating a second source of process truth.

The Student Workspace remains a projection over durable institutional state. It does not introduce `current_step`, editable process status, password recovery, or a second QR authority.

## Student projection

The authenticated Staff workspace now projects:

- CPF from `students.cpf_normalized`;
- date of birth;
- identity document type / number / issuing UF;
- phone and e-mail;
- optional address;
- the legacy compatibility document only as backward-compatible data.

CPF and identity document remain distinct concepts.

## Enrollment projection

Each Enrollment now projects:

- service type;
- category;
- institutional enrollment status;
- opened/completed timestamps;
- notes;
- RENACH belonging to that Enrollment;
- ordered `enrollment_intake_observations`.

The intake observations are evidence, not a mutable current step:

- `DETRAN_PROCESS_STARTED`
- `RENACH_OBSERVED`
- `THEORY_COURSE_COMPLETED`
- `THEORY_EXAM_PASSED`

## UI

`/admin/alunos/:id` now presents:

1. institutional identity facts;
2. access / persistent Student QR;
3. the existing Process projection;
4. enrollment history with RENACH and intake evidence;
5. recent audit history.

The existing QR law is preserved: the QR locates Student identity and never authenticates Staff or replaces the Student password.

## Search

`GET /api/admin/students?q=...` also matches modern CPF and identity document number while preserving previous search behavior.

## Witness

`server/http/admin-students.test.ts` now materializes a modern enrollment and proves that the Staff workspace returns:

- CPF;
- identity document;
- address;
- birth date;
- Enrollment RENACH;
- ordered intake observations;
- audit continuity;
- no credential hash or initial password leakage.

No schema migration is required: `0010_modern_enrollment_intake.sql` already owns the durable data.
