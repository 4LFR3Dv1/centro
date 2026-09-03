# ADMIN-002 — Enrollment Materialization

Program ledger: issue #26.

Status: `C4_CANDIDATE — CI_AND_PRODUCTION_ADMISSION_PENDING`

## Authority

This cut materializes one operational act only: **a Staff user creates an Enrollment and receives the Student's institutional access receipt when a credential is first created.**

It does not authorize student portal, lessons, scheduling, process milestones, student guides, reports, or a general admin cockpit.

## Accepted laws

```text
PUBLIC VISITOR != STUDENT
STUDENT REQUIRES ENROLLMENT
Student != Enrollment
CPF/document != login
plaintext password != durable state
audited actor identity is preserved
one Student/service/category may have at most one ACTIVE or PAUSED Enrollment
```

Historical `COMPLETED` or `CANCELLED` enrollments may repeat the same service/category. Open institutional relationships may not.

## C1 — transactional materialization

`materializeEnrollment()` performs one SERIALIZABLE transaction:

```text
normalized document
  -> advisory transaction lock
  -> find/reuse Student OR create Student
  -> create StudentCredential only when absent
  -> create Enrollment
  -> append AuditEvents
  -> COMMIT
```

If any write or audit insertion fails, the entire operation rolls back. The initial password is cleared from runtime state on rollback.

A later Enrollment for the same normalized document reuses the Student and `public_id`; it does not create a second credential or reveal/reset the existing password.

Migration `0003_open_enrollment_uniqueness.sql` rejects a second `ACTIVE/PAUSED` Enrollment for the same Student/service/category. The DB witness proves the rejected attempt does not append an `ENROLLMENT_CREATED` audit receipt.

## C1R — audit actor preservation

The first ADMIN-002 witness exposed a contradiction in ADMIN-001: `audit_events` required an explicit Staff/Student actor but its actor foreign keys used `ON DELETE SET NULL`.

Migration `0002_audit_actor_preservation.sql` reconciles this to `ON DELETE RESTRICT`. An actor referenced by durable audit history cannot be deleted silently.

## C2 — Staff-authenticated HTTP authority

Routes:

```text
POST /api/admin/auth/login
GET  /api/admin/auth/session
POST /api/admin/auth/logout
POST /api/admin/enrollments
```

The Enrollment endpoint never accepts an actor ID from the browser. It resolves a Staff session from the `centro_admin_session` HttpOnly cookie and supplies that Staff identity to `materializeEnrollment()`.

Session properties:

- random 256-bit bearer token;
- only SHA-256 digest is durable;
- HttpOnly;
- SameSite=Lax;
- Secure in production;
- 12-hour expiration;
- explicit logout revocation;
- POST origin validation when `CENTRO_PUBLIC_ORIGIN` is configured (mandatory in production runtime).

First Staff bootstrap is one-time and guarded by a PostgreSQL advisory lock. Existing Staff state prevents reapplying a bootstrap credential. Runtime and CLI use the same canonical `CENTRO_BOOTSTRAP_ADMIN_*` variable family (CLI retains legacy fallback only for compatibility).

## C3 — minimal admin surface

Routes under `/admin` have a dedicated React surface, separate from the public Centro shell.

Available behavior only:

```text
/admin/login
/admin
/admin/matriculas/nova
/admin/matriculas/receipt   # valid only while receipt exists in memory
```

The form accepts student identification/contact data, service and category. `FIRST_LICENSE + D` is omitted by the UI and still rejected by domain/DB laws.

A successful first enrollment renders an ephemeral access receipt:

```text
student public ID
initial password
```

The receipt lives only in React memory. Reload, logout, Back, or navigation away from the receipt route removes it. Returning directly to the receipt URL without in-memory material redirects to a new enrollment instead of reconstructing the password.

Existing Students show `Acesso existente`; no password is recovered or exposed.

The print action in this cut prints only the access receipt. Full school/student guide generation remains `DOCS-001` authority.

## C4 — production runtime candidate

The deployment image moves from static Nginx ownership to one Node process:

```text
startup
  -> migrations (advisory locked)
  -> PostgreSQL readiness
  -> optional one-time Staff bootstrap
  -> listen

request
  -> /healthz (includes DB witness)
  -> /api/admin/*
  -> dist static asset / SPA fallback
```

Production startup fails closed when `CENTRO_PUBLIC_ORIGIN` is absent.

CI builds frontend + server + Docker image and boots the final production image against PostgreSQL 17 before accepting the runtime.

## Railway durability witness

Production now has a dedicated `centro-postgres` service using `postgres:17-alpine` with a Railway volume mounted at `/data` and `PGDATA=/data/pgdata`.

Physical persistence was proven before any real enrollment:

1. first boot initialized the cluster under `/data/pgdata`;
2. a controlled service redeploy completed successfully;
3. second boot logged `PostgreSQL Database directory appears to contain a database; Skipping initialization`;
4. PostgreSQL returned `ready to accept connections`.

`centro-web` has production variables staged with deploy suppressed:

- `DATABASE_URL` references `centro-postgres.DATABASE_URL` through Railway private networking;
- `CENTRO_PUBLIC_ORIGIN=https://centro-web-production.up.railway.app`;
- one-time `CENTRO_BOOTSTRAP_ADMIN_*` variables.

The public runtime is not changed merely by this staging.

## Remaining admission sequence

1. latest PR CI passes migrations, DB/API witnesses, data validations, frontend/server builds, Docker build and final-image runtime smoke;
2. mark PR ready and merge;
3. Railway deploy starts against durable `centro-postgres`;
4. migrations complete before listen;
5. first Staff bootstrap creates exactly one Staff identity;
6. `/healthz = 200` and `/admin` serves the operational SPA;
7. Staff login succeeds and one real Enrollment is created through the admin surface;
8. bootstrap plaintext variables are emptied/removed after the first Staff creation.
