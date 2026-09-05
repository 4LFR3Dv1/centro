# Centro

Centro is a **public traffic platform and operational driving-school system** with Auto Escola Centro as its first institutional operator.

It is no longer only a public static product. The repository now contains three projections over one institutional core:

```text
PUBLIC                    STUDENT                    SCHOOL
/ /cnh /guias ...         /aluno                     /admin
self-service               enrolled experience        operations
      \                         |                         /
       \________________________|________________________/
                                |
                           CENTRO CORE
                                |
                         PostgreSQL state
```

## Constitutional product boundary

```text
PUBLIC VISITOR != STUDENT.

PUBLIC VALUE MUST NOT REQUIRE
AUTO ESCOLA CENTRO ENROLLMENT.

STUDENT STATE MUST NOT EXIST
WITHOUT AN ENROLLMENT.

STUDENT != ENROLLMENT.

PROCESS STATE IS DERIVED FROM FACTS,
NOT FROM AN ARBITRARY current_step.
```

The public product remains independently useful to any driver or future driver. Institutional Student state exists only after a confirmed Enrollment.

## Current regimes

### Public

Public routes remain accountless and independently useful:

```text
/
├── /cnh
├── /transito
├── /guias
├── /ferramentas
│   └── /ferramentas/minha-jornada
├── /sao-jose-dos-campos
└── /auto-escola-centro
```

The public journey is a browser-local self-declared checkpoint and is **not** an institutional Student record.

### Student

The Student surface is an authenticated projection of real institutional state:

```text
/aluno
├── home
├── calendar
├── process
├── exams
├── guides
└── account / security
```

The Student sees a simplified projection of the same Enrollment, Lesson, Process, Exam and Guide state operated by the School.

### School

`/admin` is an operational cockpit, not a generic CRUD.

Current school capabilities include:

- modern Enrollment intake;
- Student search and institutional record;
- persistent Student QR identity lookup;
- operational Process actions;
- theory exam attempts;
- practical exam rosters and results;
- Lesson scheduling with conflict rejection;
- school calendar;
- immutable Student guides;
- operational Home with current, upcoming and attention-required work;
- Staff security and audit evidence.

## Identity and access

### Student identity

A Student has an internal UUID and a human-facing institutional ID:

```text
Student UUID      internal identity
CEN-YY-NNNNN      public institutional identity
StudentAccessQr   persistent physical/digital locator
```

CPF and identity documents are institutional attributes. They are never login credentials.

### QR-first activation

`ACCESS-002` superseded the old staff-issued temporary-password model.

A new Enrollment materializes the Student, Enrollment and persistent QR, but **does not create a StudentCredential**.

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
  -> Argon2id StudentCredential
  -> Student Session
  -> AuditEvent
  -> /aluno
```

After activation, the QR is an **identity locator only**. It never authenticates the Student or Staff by itself.

Staff never creates, receives, stores, displays, recovers or resets the Student's chosen password through Enrollment.

## Institutional core

The server is organized by domain authority instead of one generic workflow engine:

```text
server/
├── admin
├── db
├── enrollments
├── exams
├── guides
├── http
├── ops
├── process
├── schedule
├── staff
├── student
└── theory-exams
```

### Durable schema evolution

Current migrations:

```text
0001 operational constitution
0002 audit actor preservation
0003 open enrollment uniqueness
0004 lesson kernel
0005 process milestones
0006 student guides
0007 practical exam rosters
0008 student access QR
0009 QR-first activation
0010 modern enrollment intake
0011 theory exam attempts
```

PostgreSQL is the institutional source of truth.

## Process model

Centro deliberately does **not** persist an arbitrary `current_step`.

The Process is derived from institutional facts and milestones. Student and School render different projections over that same state.

Operational execution also does not introduce a generic `/actions/execute` authority or a parallel task/workflow table. Typed operational commands are dispatched only to the domain that owns the fact being changed.

Examples:

```text
Process milestone       -> PROCESS
Theory exam             -> THEORY-EXAM-001
Lesson scheduling       -> SCHEDULE / Lesson Kernel
Practical exam          -> EXAMS-001
Student access           -> ACCESS
```

The current Student detail keeps the Process card as the normal action surface. Identity remains identity; contextual access/enrollment information does not compete with operational commands.

## Scheduling

`SCHEDULE-001` is the Lesson conflict authority.

A Lesson is bound to Student, Enrollment, Instructor, Vehicle and SchedulePolicy. Overlapping active intervals for Student, Instructor or Vehicle are rejected before creation.

`/admin/agenda` and the Student calendar are projections over the same Lesson domain. There is no second calendar authority.

## Exams

Theory and practical exams have explicit domain ownership.

`THEORY-EXAM-001` stores immutable theory attempts and separates attendance, observed result and official result. Only an official approved result materializes `THEORY_PASSED`.

`EXAMS-001` owns practical exam scheduling/rosters/results. Process cannot bypass those authorities by directly writing exam milestones.

## Guides

`DOCS-001` owns versioned immutable Student Guide snapshots, preview, print and generation receipts. Guides reflect institutional state but do not create new process authority.

## Operational Home

`ADMIN-HOME-002` replaces the earlier heuristic Today surface with a derived operational projection.

The Home aggregates typed actions and upcoming institutional events without introducing task tables, manual priority state or a parallel workflow engine.

## Public data provenance

The public traffic product keeps a source registry with explicit provenance fields:

```text
source
scope
freshness
checkedAt
status
```

Public source families include Detran-SP guidance/data and São José dos Campos traffic/mobility sources. The UI must not fabricate indicators for data that has not been ingested.

## Stack

Current product stack includes:

- React + TypeScript;
- Vite;
- Node.js server runtime;
- PostgreSQL;
- Argon2id credentials;
- HttpOnly sessions;
- FullCalendar-based school calendar;
- Docker deployment;
- Railway production runtime.

## Operational contracts

Durable implementation contracts live in `docs/operations/` and include, among others:

```text
ADMIN-001..004
ACCESS-001..002
SCHEDULE-001..002
PROCESS-001
PROCESS-OPS-001..002
DOCS-001
EXAMS-001
THEORY-EXAM-001
ENROLLMENT-002
STUDENT-001..007
STUDENT-DETAIL-002..004
ADMIN-HOME-002
```

`docs/operations/CENTRO-STATE-001.md` records the reconciliation that established this README as the current repository narrative.

## Deployment contract

The production image builds the frontend and server runtime and runs the institutional service against PostgreSQL.

Health/runtime validation remains part of the admission gate. Production admission is not inferred from source changes alone: CI and deployment evidence remain required.

## Current state

As of `CENTRO-STATE-001`, the canonical architecture is:

```text
PUBLIC              STUDENT              SCHOOL
   |                    |                    |
accountless         enrolled UX         operations
   |                    |                    |
   +--------------------+--------------------+
                        |
                   CENTRO CORE
                        |
              institutional facts
                        |
                   PostgreSQL
```

The next product work should be selected from **actual operational gaps in this architecture**, not from the superseded R3B/R4/R5 roadmap.