# STUDENT-DETAIL-004 — Identity & Action Hierarchy

Status: **CANDIDATE / AWAITING CI**

Program ledger: #26.

## Purpose

Remove competing calls-to-action and duplicate operational guidance from `/admin/alunos/:id`.

The Student detail must express three visual layers:

```text
IDENTITY
Student identity and stable civil facts

OPERATION
Current Process state and its derived next command

CONTEXT / HISTORY
Access, current Enrollment, Student Guide, enrollments and audit
```

## Identity

The hero is no longer an administrative card. It contains only:

- Student public ID;
- Student status as metadata;
- full name;
- contact line.

`Nova matrícula` is not available from the Student detail. Enrollment creation remains owned by the enrollment surface.

The four stable facts remain immediately visible. The complete institutional record is collapsed by default under `REGISTRO INSTITUCIONAL` to avoid repeating CPF, birth date and identity at equal visual weight.

## Process as the action surface

`AdminOperationalGuidance` no longer renders as a second large block above the Process.

For each operational Enrollment, `AdminProcessPanel` renders:

```text
Process state
  ↓
Milestone timeline / evidence
  ↓
Embedded OperationalCommand
  ↓
Owner-domain execution
```

The embedded command is enrollment-scoped. It is selected from the existing `SchoolOperationalProjection.actions` by `enrollmentId`.

No new command authority is created.

Owner domains remain unchanged:

- Process for process-owned milestones;
- THEORY-EXAM-001 for theory attempts/results;
- Lesson Kernel for practical lessons;
- EXAMS-001 for practical exam operations.

The Process panel no longer exposes a second direct `achieve` CTA for the current milestone. Advancement uses the admitted `OperationalCommand` path. Reversal of eligible process-owned milestones remains an explicit secondary correction operation.

## Exceptional guidance

The standalone `AdminOperationalGuidance` capability remains reusable by other surfaces. The Student detail uses its embedded projection so normal `ACTION_REQUIRED`, `SCHEDULED`, `WAITING` and `COMPLETE` states do not duplicate the Process card.

## Invariants

- no DB migration;
- no API change;
- no ProcessResolver change;
- no `current_step`;
- no new task or workflow table;
- no owner-domain authority change;
- no new Enrollment creation path;
- Student Guide, QR and Access contracts unchanged;
- `centro:process-changed` remains the reconciliation signal after mutations.

## Admission

Merge only after inherited operational witnesses, frontend/server TypeScript, deployment image and runtime smoke are green.
