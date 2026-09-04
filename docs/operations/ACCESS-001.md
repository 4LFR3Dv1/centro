# ACCESS-001 — Persistent Student QR Identity

## Purpose

Close the physical-to-digital access loop:

```text
Enrollment
  -> Student identity
  -> persistent QR
  -> student login (public_id prefilled)
  -> password
  -> mandatory first-password rotation
  -> student portal
```

The same QR is also a Staff-only exact lookup key for the operational Student workspace.

## Laws

1. QR is an identity locator, never an authentication credential.
2. Student password is never encoded in the QR.
3. Student password plaintext is still returned only once when a credential is first created and is never persisted.
4. QR belongs to Student, not Enrollment. A returning Student keeps the active QR across future enrollments.
5. Exactly one active QR exists per Student.
6. Rotated QR history is preserved. Old QR stops opening Student login but Staff can still identify its owner.
7. Public QR resolution returns only `student.public_id`.
8. Staff QR lookup requires a valid Staff session.
9. QR rotation is an operational mutation and emits `STUDENT_ACCESS_QR_ROTATED`.
10. No PNG/blob is persisted. The database persists identity/token state; UI renders the QR deterministically.

## Persistence

`student_access_qrs`

- `id`
- `student_id`
- `public_token`
- `rotated_from_id`
- `created_at`
- `revoked_at`

A partial unique index enforces one active row per Student. Migration `0008_student_access_qr.sql` backfills existing Students.

## Enrollment integration

`materializeEnrollment()` remains the transaction authority. Within the same SERIALIZABLE transaction it now ensures an active QR after Student/Credential materialization and before commit. Existing Student identities preserve both their current credential and current QR.

## HTTP

Public:

- `GET /api/student/access/:token`
  - active QR -> `{ publicId }`
  - revoked QR -> `410`
  - unknown QR -> `404`
  - never creates a Session

Staff:

- `GET /api/admin/students/:studentId/access-qr`
- `POST /api/admin/student-access/lookup`
- `POST /api/admin/students/:studentId/access-qr/rotate`

POST mutations require the configured public Origin.

## UI

Enrollment receipt:

- persistent QR
- Student public ID
- one-time initial password when newly created
- print/copy actions

Student:

- `/aluno/acesso/:token` resolves only the public ID
- password remains required
- first access still flows through mandatory password rotation

Staff:

- `/admin/alunos` has camera QR lookup plus paste fallback
- `/admin/alunos/:id` permanently exposes the active QR and its access URL
- Staff may rotate the QR

Runtime camera permission is limited to same-origin (`camera=(self)`). Microphone/payment remain disabled.

## Witness

`server/http/student-access-api.test.ts` proves:

- first Enrollment creates QR and one-time password
- later Enrollment reuses Student, Credential and QR
- public QR resolution does not authenticate
- anonymous Staff QR access is rejected
- exact Staff QR lookup resolves Student
- Origin is enforced for rotation
- rotation leaves exactly one active QR
- old QR returns `410` publicly but remains Staff-resolvable
- new QR resolves publicly
- create/rotate audit events exist

## Non-goals

- QR magic-login
- password recovery through QR
- CPF/document login
- storing rendered QR images
- exposing Student PII through public QR resolution
