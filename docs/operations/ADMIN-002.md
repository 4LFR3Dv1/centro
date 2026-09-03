# ADMIN-002 — Enrollment Materialization

Status: `CHECKPOINT C2 — AUTHENTICATED_API_CANDIDATE`

Program ledger: issue #26.

## Authority

ADMIN-002 materializes a real enrollment transaction and the minimum authenticated admin surface required to invoke it. It may switch the production runtime from static nginx to Node only after the transaction and API are independently proven.

It does not yet own the full Student workspace, lessons, schedule, milestones or document engine.

## Transaction law

```text
CONFIRM ENROLLMENT
  ↓
Staff session establishes actor
  ↓
lock normalized document identity
  ↓
find/reuse Student OR create Student
  ↓
ensure one StudentCredential
  ↓
create Enrollment
  ↓
write AuditEvent(s)
  ↓
COMMIT
```

Any failure before commit must erase every newly-created row in that enrollment attempt.

## Identity behavior

- The same normalized document reuses the same `Student` and `student.public_id`.
- A new Student gets the next `student_public_id_seq` value formatted as `CEN-YY-NNNNN`.
- A credential is created only when the Student does not already have one.
- The initial password plaintext is returned only in the enrollment receipt where that credential was first created.
- A later enrollment never reveals or regenerates the existing password automatically.

## C1 / C1R findings

C1 exposed an inherited contradiction in ADMIN-001: audit actor foreign keys used `ON DELETE SET NULL` while the actor consistency check required those IDs to exist for Staff/Student actors.

C1R reconciles that law with `ON DELETE RESTRICT`. Audit actor identity is now preserved.

## Staff authority

The browser never supplies `actorStaffUserId` to the enrollment transaction.

```text
centro_admin_session (HttpOnly cookie)
  ↓
SHA-256 token lookup
  ↓
active StaffUser + StaffCredential
  ↓
StaffSession.staffUserId
  ↓
materializeEnrollment(actorStaffUserId)
```

This makes audit authority server-derived.

### Bootstrap

`npm run admin:bootstrap` is a one-time first-admin operation controlled by:

- `ADMIN_BOOTSTRAP_USERNAME`
- `ADMIN_BOOTSTRAP_DISPLAY_NAME`
- `ADMIN_BOOTSTRAP_PASSWORD`

It refuses to create another bootstrap admin once any StaffUser exists and never prints the password.

### Session contract

- 256-bit random token;
- SHA-256 digest stored in PostgreSQL;
- plaintext token only in an HttpOnly cookie;
- `SameSite=Lax`;
- `Secure` in production;
- 12-hour lifetime;
- revoked on logout;
- Staff login is audited.

### Mutation origin

Admin POST requests require the configured same-origin value when `publicOrigin` is supplied. This is the first CSRF boundary; no CORS is enabled.

## API in C2

```text
POST /api/admin/auth/login
GET  /api/admin/auth/session
POST /api/admin/auth/logout
POST /api/admin/enrollments
```

Enrollment response exposes the initial password only when `credential.created=true`; no password hash is ever serialized.

## Proof targets

PostgreSQL + HTTP integration tests require:

1. wrong Origin rejected;
2. wrong password rejected with generic 401;
3. enrollment without Staff session rejected;
4. successful login sets HttpOnly session cookie and does not return token in JSON;
5. first enrollment returns one-time credential receipt;
6. second enrollment reuses Student ID and returns no password;
7. Enrollment audit actor equals the authenticated StaffUser;
8. logout revokes the session;
9. old cookie cannot mutate after logout.

## Planned checkpoints

- C1 — transaction + PostgreSQL proof.
- C1R — audit actor preservation reconciliation.
- C2 — Staff bootstrap/auth + Enrollment HTTP API.
- C3 — `/admin/matriculas/nova` + one-time credential receipt.
- C4 — Node production runtime + Railway PostgreSQL migration witness.
