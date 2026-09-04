# DOCS-001 — Student Guide

Status: **CANDIDATE / AWAITING CI**

Program ledger: #26.

## Purpose

Materialize a versioned Student Guide that can be previewed by the school, generated as a durable receipt, printed, and read by the authenticated Student.

The Guide is not a second process state. It is an immutable snapshot of the already admitted institutional state.

```text
Enrollment + ProcessResolver + Lesson
                 |
                 v
        Student Guide Preview
                 |
          Staff generates
                 |
                 v
     immutable student_guides row
                 |
       +---------+---------+
       |                   |
   /admin workspace     /aluno/guia
       |                   |
    preview/print        read/print
```

## Constitutional laws

1. **GUIDE != LIVE STATE.** A generated guide is a historical snapshot, not mutable live state.
2. **PREVIEW != GENERATION.** Preview reads current state and persists nothing.
3. **GENERATION IS AUDITABLE.** Every generated version creates `STUDENT_GUIDE_GENERATED`.
4. **TEMPLATE IS VERSIONED.** `CENTRO_STUDENT_GUIDE@1` identifies the rendering contract.
5. **CONTENT IS IDENTIFIABLE.** Canonical snapshot JSON is hashed with SHA-256 and persisted as `content_sha256`.
6. **STUDENT GUIDE USES SHARED STATE.** Process comes from `ProcessResolver`; agenda comes from the accepted `Lesson` domain.
7. **NO CREDENTIAL DATA.** Passwords, hashes, sessions and documents are absent from the guide snapshot.
8. **STUDENT ACCESS IS OWNED.** A Student can only read guides whose `student_id` is their authenticated identity.
9. **FIRST ACCESS GATE REMAINS.** `must_change_password=true` blocks Student guide access.
10. **PRINT DOES NOT CREATE AUTHORITY.** Printing is a projection of an existing generated version or admin preview.

## Durable state

Migration: `0006_student_guides.sql`.

`student_guides` stores:

- guide UUID;
- Student + Enrollment pair;
- template id/version;
- JSON snapshot;
- SHA-256 digest;
- generating Staff identity;
- generation instant.

The composite Enrollment/Student FK guarantees that a guide cannot bind a Student to another Student's Enrollment.

Generated versions are append-only in this cut. A later state change produces a new version; it never mutates an older snapshot.

## Snapshot schema

`CENTRO_STUDENT_GUIDE_SNAPSHOT_V1` contains only delivery-relevant institutional projections:

- Student public identity (`public_id`, name);
- Enrollment service/category/status/opened date;
- Process model/current derived state;
- milestone path and scheduled exam facts;
- practical lesson progress;
- derived next action;
- upcoming Lessons;
- recent Lesson history.

The anonymous `/cnh` local state is never imported.

## APIs

### Staff

- `GET /api/admin/guides/preview?studentId=...&enrollmentId=...`
  - authenticated Staff only;
  - builds the current snapshot;
  - persists nothing.

- `GET /api/admin/guides?studentId=...`
  - version history for one Student.

- `POST /api/admin/guides`
  - body: `{ studentId, enrollmentId }`;
  - same-origin protected;
  - persists snapshot + digest + Staff authority;
  - returns receipt and generated guide.

- `GET /api/admin/guides/:guideId`
  - fetch one generated version.

### Student

- `GET /api/student/guides`
  - own generated versions only.

- `GET /api/student/guides/:guideId`
  - own guide only;
  - another Student's guide resolves as 404.

## Surfaces

### School

The Student workspace now contains a **Guia do aluno** operation beside the process projection:

- select operational Enrollment;
- preview current state;
- generate a new version;
- receive template/digest/timestamp receipt;
- browse previous versions;
- print preview or generated version.

### Student

`/aluno/guia` provides:

- generated-version history;
- latest version by default;
- process + next action + agenda snapshot;
- print action.

Student home and top navigation link to the Guide after first-password rotation.

## Printing

`StudentGuideDocument` is a shared rendering primitive for Staff and Student surfaces.

Print mode:

- A4 page contract;
- isolates the Guide from application chrome;
- preserves generated template/version/digest metadata;
- does not generate a new database version merely because the user prints.

## Witness

`server/http/student-guide-api.test.ts` must prove with real PostgreSQL + HTTP:

1. anonymous Staff preview is rejected;
2. preview persists no `student_guides` row;
3. wrong POST Origin is rejected;
4. Staff generation persists template/version/digest;
5. generated version produces `STUDENT_GUIDE_GENERATED`;
6. Student first-access state is rejected;
7. after password rotation Student can read own version;
8. cross-Student guide access is 404;
9. later process mutation changes a new preview but not the old generated snapshot;
10. a new generation after the mutation has a different digest;
11. Student version history contains both historical states.

All inherited ADMIN/STUDENT/SCHEDULE/PROCESS witnesses remain mandatory.

Docker smoke additionally proves:

- `/aluno/guia` resolves through the production SPA;
- anonymous `/api/admin/guides` is 401;
- anonymous `/api/student/guides` is 401.

## Explicit non-goals

- arbitrary document uploads;
- digital signatures;
- email/WhatsApp delivery;
- PDF binary persistence;
- Student-generated guide versions;
- manual editing of snapshot content;
- password recovery/settings;
- `ADMIN-004 — Today` cockpit.

## Admission boundary

DOCS-001 may merge only after:

- migration applies idempotently through the migration ledger;
- TypeScript server check passes;
- PostgreSQL/HTTP witness passes;
- every inherited operational witness passes;
- public data validations pass;
- frontend/server builds pass;
- deployment image builds;
- production runtime smoke passes.

After admission, the next authorized program cut is `ADMIN-004 — Today`.
