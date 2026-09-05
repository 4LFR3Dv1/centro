# ACCESS-002 — QR First Activation

## Objective

Replace staff-issued temporary Student passwords with a QR-first activation flow.

A new enrollment materializes the institutional identity and the persistent Student QR, but **does not create `StudentCredential`**. The Student chooses the first password only when activating the current QR.

## Laws

1. `StudentAccessQr` belongs to `Student`, never to `Enrollment`.
2. Before activation, the current active QR is an activation capability; revoked QRs cannot activate.
3. After activation, QR returns to being an identity locator and never authenticates by itself.
4. Staff never creates, receives, stores, displays, recovers or resets the Student's chosen password through enrollment.
5. `StudentCredential` does not exist before activation.
6. Activation is single-use with respect to credential creation.
7. Rotating a QR before activation transfers activation authority to the new QR only.
8. Rotating a QR after activation never creates or changes a password.
9. Existing pre-ACCESS-002 credentials remain valid. Legacy `must_change_password=true` sessions retain their existing migration path.
10. Activation and its first Student session are one atomic transaction and produce `STUDENT_ACCESS_ACTIVATED` plus `STUDENT_LOGIN` audit evidence.

## Flow

```text
Staff enrollment
  -> Student
  -> Enrollment
  -> persistent active QR
  -> NO StudentCredential

Student scans active QR
  -> public identity resolution
  -> activationRequired=true
  -> Student chooses password
  -> Argon2id hash
  -> StudentCredential(must_change_password=false)
  -> Student Session
  -> activated_at
  -> AuditEvent
  -> /aluno

Later scans
  -> activationRequired=false
  -> ID pre-resolved
  -> password required
  -> normal login
```

## HTTP

- `GET /api/student/access/:token`
  - active QR only;
  - returns `publicId`, `firstName`, `activationRequired`;
  - never creates a session.
- `POST /api/student/access/:token/activate`
  - origin protected;
  - requires an active QR, active Student, active Enrollment and no existing StudentCredential;
  - accepts a 12–128 character password;
  - creates credential + session atomically;
  - returns the normal Student session payload and HttpOnly session cookie.
- `GET /api/admin/students/:id/access-qr`
  - Staff only;
  - projects `activatedAt` and `activationRequired`.
- Staff lookup/rotation from ACCESS-001 remain authoritative.

## Compatibility

Migration `0009_qr_first_activation.sql` adds `activated_at`. Existing Students with credentials are marked activated at the institutional cutover time (the current QR's creation timestamp). No historical activation time is invented.

## Witness

The DB/HTTP witness proves:

- enrollment creates no StudentCredential and no password;
- the active QR reports activation required;
- a revoked pre-activation QR cannot activate;
- a rotated pre-activation QR can activate;
- wrong origin and short passwords are rejected;
- first activation creates Argon2id credential + session and no forced password change;
- second activation is rejected;
- chosen password works through normal Student login;
- later enrollments preserve the same credential and QR;
- rotation after activation creates locator-only QR and does not request another password;
- old QR remains Staff-resolvable but Student-inactive.
