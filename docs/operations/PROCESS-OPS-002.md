# PROCESS-OPS-002 — Action Execution

## Purpose

Turn the accepted School operational projection into an executable cockpit without creating a second workflow authority.

```text
institutional facts
      ↓
ProcessResolver
      ↓
SchoolOperationalProjection
      ↓
typed OperationalCommand
      ↓
owner domain API
      ↓
new institutional fact
      ↓
ProcessResolver recomputes
```

`PROCESS-OPS-002` owns **which action the School should see**. It does not own the mutation performed by that action.

## No generic executor

There is deliberately no endpoint such as:

```text
POST /api/admin/process/actions/execute
```

Such an endpoint would silently turn PROCESS-OPS into the owner of Process, Schedule and Exams.

The frontend dispatches a typed command to the already-authoritative domain instead.

## Command vocabulary

The School projection may emit:

- `ACHIEVE_MILESTONE`;
- `SCHEDULE_THEORY_EXAM`;
- `MANAGE_THEORY_EXAM`;
- `SCHEDULE_LESSON`;
- `ADD_TO_PRACTICAL_EXAM`;
- `MANAGE_PRACTICAL_EXAM`;
- `OPEN_URL`.

Commands carry only the context required to open the correct interaction. They do not contain hidden process mutations.

## Authority matrix

| Operational condition | Command | Mutation owner |
| --- | --- | --- |
| Cadastro/biometria concluídos | `ACHIEVE_MILESTONE(REGISTRATION_DONE)` | PROCESS |
| Avaliações de saúde concluídas | `ACHIEVE_MILESTONE(HEALTH_DONE)` | PROCESS |
| Prova teórica sem tentativa aberta | `SCHEDULE_THEORY_EXAM` | THEORY-EXAM-001 |
| Presença/resultado teórico pendente | `MANAGE_THEORY_EXAM` | THEORY-EXAM-001 |
| Preparação prática precisa continuar | `SCHEDULE_LESSON` | SCHEDULE / Lesson Kernel |
| Preparação prática institucionalmente concluída | `ACHIEVE_MILESTONE(PRACTICE_DONE)` | PROCESS |
| Exame prático sem candidato aberto | `ADD_TO_PRACTICAL_EXAM` | EXAMS-001 |
| Presença/resultado prático pendente | `MANAGE_PRACTICAL_EXAM` | EXAMS-001 |
| CNH disponível | `ACHIEVE_MILESTONE(LICENSE_AVAILABLE)` | PROCESS |

## Owner-domain cutover

After this cut, the generic Process HTTP mutation surface rejects all `schedule`, `achieve` and `revoke` commands for:

- `THEORY_PASSED` — authority belongs to `THEORY-EXAM-001`;
- `PRACTICAL_EXAM_PASSED` — authority belongs to `EXAMS-001`.

The milestones remain Process projections. Their evidence enters through the owner domains.

This prevents UI or callers from bypassing:

- theory attendance;
- observed theory result;
- official theory reconciliation;
- practical exam roster eligibility;
- practical exam attendance;
- observed practical result;
- official practical reconciliation.

## School workspace

`/admin/alunos/:id` keeps `O QUE PRECISA ACONTECER AGORA` as the primary operational surface.

The primary command executes in-place when the operation can safely be contextualized:

- milestone confirmation;
- theory exam scheduling / attendance / observed result / official reconciliation;
- Lesson scheduling;
- practical-exam roster inclusion / attendance / observed result / official reconciliation.

Secondary commands expose legitimate alternatives. During practice, for example, scheduling another Lesson is normally primary while explicit `PRACTICE_DONE` remains available as a secondary institutional decision.

The Lesson evidence does **not** automatically achieve `PRACTICE_DONE`.

## Practical absence

An `ABSENT` practical-exam candidate remains an open roster fact while its session is open. PROCESS-OPS therefore projects a `WAITING` state and routes Staff to the exam list; it does not offer an impossible official-result reconciliation or fabricate a new attempt before the current roster is resolved.

## Legacy Process panel

The detailed Process panel remains useful as an institutional timeline/read model.

It no longer offers direct theory/practical exam scheduling, achievement or reversal. Those operations are executed by the operational guidance and owner domains.

Generic Process mutations remain available only for milestones that Process still owns.

## Witnesses

`server/admin/student-operations.test.ts` proves:

- Student QR resolves to the same Student operational context;
- practice without future Lesson derives `SCHEDULE_LESSON`;
- `PRACTICE_DONE` remains a secondary explicit command;
- scheduling a real Lesson recomputes the primary command;
- theory frontier derives `SCHEDULE_THEORY_EXAM`;
- an open attempt derives `MANAGE_THEORY_EXAM`;
- presence changes the projection to result-required;
- observed result changes the projection to official-reconciliation-required;
- official failure preserves history and returns the School to a new scheduling command.

`server/http/process-api.test.ts` proves the owner-domain cutover end to end:

```text
Process direct THEORY_PASSED mutation -> 409
THEORY-EXAM-001 official APPROVED      -> Process advances

Process direct PRACTICAL_EXAM_PASSED mutation -> 409
EXAMS-001 official APPROVED                  -> Process advances
```

The inherited Schedule, Exams, Process, Student, Today and PostgreSQL witnesses remain mandatory.

## Non-goals

- a new workflow/state table;
- generic task execution;
- automatic regulatory inference from Lesson minutes;
- automatic external DETRAN effects;
- non-FIRST_LICENSE process models;
- Student mutation authority;
- erasing or rewriting official exam history.
