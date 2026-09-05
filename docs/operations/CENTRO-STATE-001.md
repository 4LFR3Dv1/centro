# CENTRO-STATE-001 — Operational State Reconciliation

## Objective

Reconcile the repository narrative and program ledger with the operational system already accepted on `main`.

This cut introduces **no new product authority, persistence, API or UI behavior**. Its purpose is to make the documented architecture match the deployed one.

Base accepted state:

```text
3bb54129058cd0a2d9e6226c384d292e7942be43
STUDENT-DETAIL-004 — Identity & Action Hierarchy
```

## Canonical architecture

Centro now consists of three projections over one institutional core:

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

### Public

Public visitors remain outside institutional identity. Public journey/checkpoint state is not Student state.

### Student

Student state exists only because a confirmed Enrollment exists. The Student surface projects institutional Process, Lesson, Exam, Guide and account/security state.

### School

The School surface operates the same institutional facts through domain-owned commands. `/admin` is an operational cockpit, not a generic CRUD or parallel workflow engine.

## Superseded narrative

The previous README still described the repository as `CENTRO-R3B / PUBLIC-TRAFFIC-PLATFORM` and treated Student Identity and Student Portal as future regimes.

That narrative is superseded by the accepted operational program already present on `main`.

The public platform remains a first-class product surface, but no longer describes the whole repository.

## Superseded credential law

The original CENTRO-OPS ledger stated that the School generated a random initial password and that Enrollment issued a credential.

That law was valid for the original ADMIN-001/ADMIN-002 sequence but was later superseded by `ACCESS-002 — QR First Activation`.

Current law:

1. Enrollment materializes Student + Enrollment + persistent active Student QR.
2. Enrollment does **not** create `StudentCredential` for a new Student.
3. Staff never creates or learns the Student's chosen password.
4. The active pre-activation QR is an activation capability.
5. The Student chooses the first password during activation.
6. Credential + first Student Session are materialized atomically.
7. After activation, QR becomes an identity locator only and never authenticates by itself.
8. Legacy pre-ACCESS-002 credentials remain valid under the compatibility contract.

This reconciliation does not alter ACCESS-002. It records it as the current authority.

## Canonical institutional laws

The reconciled program laws are:

1. `PUBLIC VISITOR != STUDENT`.
2. Public value must not require Auto Escola Centro Enrollment.
3. `STUDENT STATE MUST NOT EXIST WITHOUT AN ENROLLMENT`.
4. `Student != Enrollment`.
5. CPF and identity documents are institutional attributes, never login credentials.
6. `student.public_id` is the human-facing institutional identity.
7. `StudentAccessQr` belongs to Student, not Enrollment.
8. Before activation, the active QR may authorize first activation; after activation it is locator-only.
9. Staff never creates or knows the Student's chosen password through Enrollment.
10. Process state is derived from facts/milestones, never an arbitrary `current_step`.
11. Student and School are different projections over the same institutional state.
12. Scheduling has one authority: Lesson/SchedulePolicy and PostgreSQL conflict guards.
13. Theory exam facts belong to THEORY-EXAM-001.
14. Practical exam facts belong to EXAMS-001.
15. Typed operational commands execute only through the domain that owns the changed fact.
16. No generic `/actions/execute`, task table or second workflow engine is introduced.
17. Every relevant operational mutation produces audit evidence.
18. Student UX may simplify state; School UX may expose the complexity necessary to operate it.
19. Admin is an operational cockpit, not a generic CRUD.

## Materialized operational authority

The reconciled repository already contains durable contracts for:

```text
ADMIN-001..004             operational constitution / enrollment / workspace / home
ACCESS-001..002            persistent QR identity / QR-first activation
SCHEDULE-001..002          lesson kernel / school calendar
PROCESS-001                milestone-derived process
PROCESS-OPS-001..002       operational guidance / typed execution
DOCS-001                   immutable Student guides
EXAMS-001                  practical exam authority
THEORY-EXAM-001            theory attempt authority
ENROLLMENT-002             modern Enrollment intake
STUDENT-001..007           Student portal and experience
STUDENT-DETAIL-002..004    institutional record and operational composition
ADMIN-HOME-002             global operational projection
```

## Database evolution at reconciliation point

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

No migration is introduced by CENTRO-STATE-001.

## Student detail reconciliation

The current Student workspace no longer treats "what needs to happen now" as a detached block.

The accepted composition is:

```text
Student identity
      |
      +-- contextual rail
      |     access / current enrollment / guide
      |
      +-- Process
            derived state
            milestones/evidence
            owner-domain OperationalCommand
```

The Process card is the single normal action surface. Identity does not compete with administrative CTAs.

## Program ledger reconciliation

Issue `#26 — CENTRO-OPS` remains the historical program ledger, but its original checklist is no longer an accurate representation of current authority.

CENTRO-STATE-001 updates that ledger to distinguish:

- accepted/materialized authority;
- superseded laws;
- current invariants;
- the next-state rule: future work must be selected from real operational gaps rather than the obsolete R3B/R4/R5 sequence.

## Invariants of this cut

CENTRO-STATE-001 must not change:

- database schema;
- HTTP routes;
- ProcessResolver behavior;
- QR semantics;
- Enrollment behavior;
- Lesson scheduling authority;
- exam authority;
- Student/Staff credential behavior;
- production runtime behavior.

Expected code/runtime delta: **zero**.

## Admission

Admission requires the documentation-only branch to pass the inherited repository CI gate. After merge, the accepted merge commit becomes the canonical documentation base for selecting the next operational workpack.