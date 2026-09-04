# ADMIN-004 — Today

Status: CANDIDATE / AWAITING CI

Base authority: accepted `DOCS-001` merge `52d8af8195fd2ad37f3ec20cab1e9237ca8f5cb6`.

## Purpose

`/admin` becomes the daily operational cockpit for Auto Escola Centro.

The cut does not create a new task table, notification state, manual priority field or duplicated process state. **Today is a projection over facts already admitted by the program.**

Law preserved:

> Admin é cockpit operacional, não um CRUD genérico.

## C1 — Today projection

`server/admin/today.ts` derives one school-day projection in `America/Sao_Paulo` from the accepted domains:

- `Lesson` for today's agenda;
- `EnrollmentMilestone` for upcoming theory/practical exams;
- active `Enrollment` + future `Lesson` for students without a next lesson;
- `StudentCredential.must_change_password` for first-access attention;
- `StudentGuide` generations for active enrollments without a guide;
- recent `Lesson.status = NO_SHOW` for recent absences.

No value in this projection becomes authority merely because it appears in Today.

### Summary

The API derives counts for:

- lessons occupying today;
- scheduled lessons still remaining;
- active enrollments without a next lesson;
- first accesses still pending;
- active enrollments without a generated Student Guide;
- no-shows from the last seven days;
- exams scheduled in the next seven days.

### Temporal law

The operational day is derived using the school timezone `America/Sao_Paulo`, not the browser timezone and not an arbitrary client-supplied date.

## C2 — Staff API

`GET /api/admin/today`

- requires a valid Staff session;
- is read-only;
- emits `Cache-Control: no-store`;
- never projects credentials or credential hashes;
- serializes the current facts needed by the cockpit only.

The handler is registered before the broad Admin API so `/api/admin/today` cannot be swallowed by the generic namespace 404.

## C3 — Cockpit surface

`/admin` is now **Hoje**.

The left rail exposes:

- Hoje;
- Agenda;
- Alunos;
- Matrículas.

The Today surface contains:

1. operational summary;
2. today's lesson timeline;
3. next seven days of theory/practical exams;
4. students/enrollments requiring attention because they have no future lesson;
5. students still on initial access;
6. active enrollments without a generated guide;
7. recent no-shows.

Rows navigate to the authoritative workspace (`/admin/alunos/:id`) or calendar (`/admin/agenda`) instead of mutating facts inline.

## Witness

`server/http/admin-today.test.ts` uses PostgreSQL and HTTP to prove:

- anonymous Today access = `401`;
- authenticated Staff can read the projection;
- a scheduled lesson is projected into today's agenda;
- a recent no-show is projected from the Lesson domain;
- an active enrollment with no future lesson appears in attention;
- pending initial access is derived from the credential fact;
- guide absence is derived from `student_guides`;
- an existing guide removes that enrollment from the missing-guide set;
- an upcoming exam is projected from the process milestone domain.

The entire inherited tribunal remains mandatory through `npm run ops:check`.

Docker/runtime smoke also proves:

- `/admin` resolves through the SPA;
- `/admin/hoje` resolves through the SPA;
- anonymous `/api/admin/today` returns `401`.

## Explicit non-goals

ADMIN-004 does not add:

- a generic task manager;
- manual priority/status flags for Today;
- notification delivery;
- WhatsApp/e-mail effects;
- lesson mutations outside SCHEDULE-002;
- process mutations outside PROCESS-001;
- guide generation outside DOCS-001;
- Staff password rotation or recovery;
- Staff profile/settings.

## Admission rule

ADMIN-004 may be accepted only after:

1. TypeScript/server checks pass;
2. all PostgreSQL witnesses pass;
3. public-data gates remain green;
4. frontend/server builds pass;
5. Docker image builds;
6. production runtime smoke passes.

After acceptance, the planned operational program through `ADMIN-004` is complete. Password/security work resumes as a separate Staff security cut rather than being smuggled into Today.
