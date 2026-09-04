# STUDENT-001 — Student Portal

Status: `CANDIDATE / AWAITING CI`

Program ledger: `#26 — CENTRO-OPS`

## Purpose

Materialize the first Student projection over the operational state already admitted by ADMIN-001/002.

This cut does not create a second student model. It reuses:

- `students` as identity;
- `student_credentials` as authentication authority;
- `sessions(subject_type = STUDENT)` as durable session state;
- `enrollments(status = ACTIVE)` as the admission condition for the portal;
- `audit_events` as the mutation witness.

## Routes

Frontend:

- `/aluno/login`
- `/aluno/trocar-senha`
- `/aluno`

HTTP API:

- `POST /api/student/auth/login`
- `GET /api/student/auth/session`
- `POST /api/student/auth/change-initial-password`
- `POST /api/student/auth/logout`

## Laws materialized

1. **CPF/document is never authentication material.** Student login accepts only `student.public_id` (`CEN-YY-NNNNN`) + password.
2. **No active enrollment, no Student portal session.** Authentication requires at least one `ACTIVE` Enrollment.
3. **Initial password is one-way.** The password issued by ADMIN-002 must be changed after first login and cannot be recovered from the database.
4. **Password rotation is mandatory before the normal portal projection.** A session with `must_change_password=true` is redirected to `/aluno/trocar-senha`.
5. **Password rotation invalidates other Student sessions.** The current first-access session survives only to complete the transition.
6. **Student and Staff authority remain separate.** Student uses the independent `centro_student_session` HttpOnly cookie and `subject_type=STUDENT`.
7. **Student mutations are audited as Student.** Login, initial-password change and logout persist the Student actor.
8. **The browser never receives session token, password hash or document.** Token plaintext exists only in the HttpOnly cookie.
9. **POST remains same-origin when `CENTRO_PUBLIC_ORIGIN` is configured.**
10. **The portal does not invent process facts.** Before PROCESS-001, it may show active enrollment and credential-derived required action only.

## Projection currently exposed

`/aluno` exposes:

- Student first name/full name;
- `public_id`;
- active enrollments;
- service/category;
- whether an immediate credential action is required.

It deliberately does **not** expose:

- arbitrary `current_step`;
- lesson/calendar state (SCHEDULE-001/002 + STUDENT-002);
- milestone/progress state (PROCESS-001);
- generated guide/documents (DOCS-001).

## Witness

`server/http/student-api.test.ts` starts a real HTTP server over PostgreSQL and proves:

1. an ADMIN-002 enrollment creates the Student credential;
2. wrong Origin is rejected;
3. wrong password is rejected;
4. `CEN-*` + initial password creates a Student session;
5. login response does not expose token or document;
6. the initial session requires password change;
7. weak password is rejected;
8. successful rotation sets `must_change_password=false` and increments `password_version`;
9. the initial password stops authenticating;
10. the new password authenticates;
11. logout revokes the durable session;
12. Student audit events preserve `actor_student_id`.

CI also requires the production image to serve `/aluno` and reject an unauthenticated `/api/student/auth/session` request.

## Admission boundary

Do not deploy this cut merely because the code exists.

Admission requires:

- TypeScript server PASS;
- PostgreSQL student HTTP witness PASS;
- existing ADMIN-001/002 witnesses remain PASS;
- frontend build PASS;
- server build PASS;
- Docker build PASS;
- production runtime smoke PASS.

Only after those gates pass should the PR be considered `ACCEPTABLE_FOR_MAIN`.
