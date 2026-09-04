# ADMIN-003 — Student Workspace

Status: **CANDIDATE / AWAITING CI**

Base authority: `STUDENT-001` accepted merge `2e01cb0d360982db0603d0649eed27ed3c34f84f`.

## Purpose

Materialize the first persistent operational workspace around an admitted `Student`, without inventing lesson, schedule or process state that belongs to later cuts.

The workspace is a projection over existing institutional facts:

```text
Student
├─ identity/contact
├─ Credential status (never secret material)
├─ Enrollment history
└─ Audit history
```

## C1 — authenticated read model

`server/admin/students.ts` provides two projections:

- `listAdminStudents()` for search/list;
- `getAdminStudentWorkspace()` for the individual workspace.

Authenticated HTTP surfaces:

```text
GET /api/admin/students?q=...
GET /api/admin/students/:id
```

Search accepts:

- `student.public_id`;
- name;
- normalized document;
- phone;
- e-mail.

The API is Staff-session protected. No public or Student session can use this authority.

## C2 — `/admin/alunos`

Materialized surfaces:

```text
/admin/alunos
/admin/alunos/:id
```

The list projects:

- institutional ID;
- name;
- administrative document;
- contact;
- active/open enrollment count;
- total enrollment count;
- Student status;
- last update.

The individual workspace projects:

- identity and contact;
- credential operational state;
- whether the first-password transition is still pending;
- password version number;
- temporary lock/disabled state;
- enrollment history;
- recent audit history.

Credential secrets are excluded by construction:

```text
password_hash     NEVER projected
initial_password  NEVER recoverable
session token     NEVER projected
```

The ADMIN-002 ephemeral receipt remains the only surface where a newly generated initial password can exist.

## Process boundary

ADMIN-003 does **not** introduce `current_step` or another mutable process pointer.

Until `PROCESS-001` is admitted, the workspace explicitly treats Enrollment/Audit facts as the available process basis and does not claim a derived current step or next action.

## Operational actions

This cut authorizes navigation from a Student workspace into the already-admitted ADMIN-002 enrollment flow. It does not yet authorize:

- credential reset;
- manual process-step mutation;
- lesson scheduling;
- enrollment lifecycle mutation beyond the existing creation primitive;
- Student deletion.

These require their own constitutional cuts/invariants.

## C3 — witnesses

`server/http/admin-students.test.ts` must prove against PostgreSQL 17:

1. unauthenticated list is `401`;
2. a Student materialized through ADMIN-002 is searchable by `CEN-*`;
3. normalized document search resolves the same Student;
4. detail projects Student + Credential state + Enrollment + Audit;
5. no password hash or initial plaintext password exists in the HTTP projection;
6. unknown Student is `404`.

Production-image smoke additionally requires:

```text
/admin/alunos -> SPA resolves
/api/admin/students without Staff session -> 401
```

## Explicitly out of scope

- `SCHEDULE-001` Instructor / Vehicle / Lesson kernel;
- `SCHEDULE-002` school calendar;
- `STUDENT-002` Student calendar;
- `PROCESS-001` milestone engine;
- `DOCS-001` generated Student guide;
- `ADMIN-004` daily cockpit.

## Admission rule

Do not merge while any of these remain unproven:

- server TypeScript;
- existing ADMIN-001/002 witnesses;
- STUDENT-001 witnesses;
- ADMIN-003 PostgreSQL/HTTP witness;
- frontend/server build;
- deployment-image build;
- production runtime smoke.
