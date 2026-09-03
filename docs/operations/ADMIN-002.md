# ADMIN-002 — Enrollment Materialization

Status: `CHECKPOINT C1 — TRANSACTION_CANDIDATE`

Program ledger: issue #26.

## Authority

ADMIN-002 is allowed to materialize a real enrollment transaction and the minimum admin surface required to invoke it. It may switch the production runtime from static nginx to Node only after the transaction is independently proven.

It does not yet own the full Student workspace, lessons, schedule, milestones or document engine.

## Transaction law

```text
CONFIRM ENROLLMENT
  ↓
lock document identity
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

## C1 proof target

PostgreSQL integration test must prove:

1. first enrollment creates Student + Credential + Enrollment;
2. durable hash is Argon2id and does not contain plaintext;
3. second enrollment with the same document reuses Student/public ID;
4. second enrollment does not create/reveal a new credential;
5. audit metadata never contains the initial password;
6. a late transaction failure (invalid Staff actor) rolls the newly-created Student back.

## Planned checkpoints

- C1 — transaction + PostgreSQL proof.
- C2 — Staff bootstrap/auth + enrollment HTTP API.
- C3 — `/admin/matriculas/nova` + one-time credential receipt.
- C4 — Node production runtime + Railway PostgreSQL migration witness.
