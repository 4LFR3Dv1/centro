# ADMIN-HOME-002 — Operational Home

## Purpose

Make `/admin` the operational entrypoint for the school.

The home answers three questions from existing institutional facts:

1. what is happening now;
2. what happens next;
3. what requires School action.

It does not create a task system.

```text
Process / Lessons / Theory Exams / Practical Exams / Student Access
                              ↓
                 SchoolOperationalProjection
                              ↓
                     AdminHomeProjection
                              ↓
                            /admin
```

## Projection law

`AdminHomeProjection` is derived on read. No `tasks`, `priorities`, `done` flags or home-specific workflow rows are persisted.

The projection contains:

- `now`: active operational windows;
- `upcoming`: Lessons and exams in the next 24 hours;
- `attention.blocking`;
- `attention.actionRequired`;
- `attention.waiting`;
- pending first access as an identity/access signal;
- operational counters derived from those collections.

`/api/admin/home` is the canonical Staff endpoint. `/api/admin/today` remains an alias during the ADMIN-004 → ADMIN-HOME-002 cutover.

## Action authority

Attention rows carry the accepted `SchoolOperationalAction` and typed `OperationalCommand` produced by PROCESS-OPS-002.

The Home owns presentation and selection only. Mutations continue to execute in their owner domains:

| Command | Owner |
| --- | --- |
| `ACHIEVE_MILESTONE` | PROCESS |
| `SCHEDULE_THEORY_EXAM` / `MANAGE_THEORY_EXAM` | THEORY-EXAM-001 |
| `SCHEDULE_LESSON` | SCHEDULE / Lesson Kernel |
| `ADD_TO_PRACTICAL_EXAM` / `MANAGE_PRACTICAL_EXAM` | EXAMS-001 |
| `OPEN_URL` | navigation only |

There is no generic `POST /api/admin/home/actions/execute` endpoint.

## Event horizon

The operational timeline uses a rolling 24-hour horizon rather than a midnight-bound queue. This avoids the artificial loss of an event near the São Paulo calendar boundary and keeps the surface focused on the next operating window.

`now` includes scheduled events with a real active interval. `upcoming` contains future events within the horizon.

## Reconciliation

The defining loop is:

```text
Home action
   ↓
owner domain mutation
   ↓
institutional fact
   ↓
Process / Schedule / Exam resolver
   ↓
AdminHomeProjection recomputes
   ↓
row changes or disappears
```

Examples:

```text
SCHEDULE_THEORY_EXAM
   ↓
THEORY-EXAM-001 creates attempt
   ↓
action leaves ACTION_REQUIRED
   ↓
Theory exam enters upcoming timeline
```

```text
SCHEDULE_FIRST_LESSON
   ↓
Lesson Kernel creates Lesson
   ↓
action leaves ACTION_REQUIRED
   ↓
Lesson enters upcoming timeline
```

## Student access

Pending first access remains a separate identity/access signal. It does not become process state and it does not affect the ProcessResolver frontier.

## UI law

The home prioritizes operational state instead of generic dashboard inventory.

Primary surfaces:

- `AGORA`;
- `PRÓXIMOS`;
- `PRECISA DE AÇÃO`;
- pending Student access.

Counts are shown only when they change what Staff should do now.

## Witness

`server/http/admin-today.test.ts` proves:

- Staff authentication is required;
- a theory frontier produces `SCHEDULE_THEORY_EXAM` on the Home;
- a practice frontier produces `SCHEDULE_LESSON` on the Home;
- creating a real TheoryExamAttempt removes the theory action and creates an upcoming event;
- creating a real Lesson through the Lesson Kernel removes the practice action and creates an upcoming event;
- `/api/admin/today` resolves to the same V2 projection during cutover.

The full repository CI remains mandatory, including migrations, operational constitution, frontend/server TypeScript, image build and production runtime smoke.

## Non-goals

- manual task creation;
- manual priority fields;
- notification delivery;
- WhatsApp/email automation;
- persistence of Home state;
- replacing Schedule, Process, Theory Exam or Practical Exam authority;
- multi-service Process modeling.
