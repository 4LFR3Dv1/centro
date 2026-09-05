# ENROLLMENT-002 — Modern Enrollment Intake

## Goal

Replace the generic paper-form intake at `/admin/matriculas/nova` with a minimum operational enrollment flow for 2026.

The form separates:

- CPF from identity document;
- Student identity from Enrollment;
- contact/address facts from process facts;
- an operator-friendly intake choice from durable process evidence.

There is no mutable `current_step` or `official_process_status` source of truth.

## Student facts

New modern enrollments capture:

- full name;
- CPF;
- birth date;
- phone;
- optional email;
- identity document type: `CIN | RG | RNE | CRNM`;
- identity document number;
- optional issuing UF;
- optional postal code, street, number and complement.

No document upload is required by this cut.

`students.document_normalized` remains as a compatibility identity key for older code. Modern enrollments write CPF to both the legacy compatibility field and `cpf_normalized`; identity document data has its own columns.

## Enrollment facts

`RENACH` belongs to Enrollment, not Student. A person can have multiple licensing processes over time.

The UI presents these intake choices:

- `NOT_STARTED`
- `PROCESS_STARTED`
- `RENACH_ISSUED`
- `THEORY_COURSE_COMPLETED`
- `THEORY_EXAM_PASSED`

The selected value is not persisted as a current step. It is expanded into `enrollment_intake_observations`:

- `DETRAN_PROCESS_STARTED`
- `RENACH_OBSERVED`
- `THEORY_COURSE_COMPLETED`
- `THEORY_EXAM_PASSED`

`RENACH_ISSUED` requires a RENACH value. For other states RENACH remains optional and is recorded if known.

## Process reconciliation

Only `THEORY_EXAM_PASSED` seeds existing institutional milestones, because a confirmed approval proves the earlier official prerequisites were already crossed. It materializes:

- `REGISTRATION_DONE`
- `HEALTH_DONE`
- `THEORY_PASSED`

`THEORY_COURSE_COMPLETED` does **not** imply approval in the theoretical exam.

`RENACH_OBSERVED` does **not** imply biometrics or health milestones.

This preserves the process law: state is derived from accepted facts, never assigned by an arbitrary step selector.

## ACCESS-002 continuity

Enrollment still never creates a password.

The transaction materializes:

`Student -> Enrollment -> intake facts -> persistent QR -> AuditEvent`

The Student creates their own credential during QR first activation.

## Audit

Modern intake produces `ENROLLMENT_INTAKE_RECORDED` with:

- selected intake situation;
- identity document type;
- whether RENACH was observed;
- whether address data was supplied;
- any institutional milestones seeded by evidence.
