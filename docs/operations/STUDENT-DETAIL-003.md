# STUDENT-DETAIL-003 — Operational Workspace Composition

Status: **CANDIDATE / AWAITING CI**

Program ledger: #26.

## Purpose

Recompose `/admin/alunos/:id` so the Student workspace reflects the semantic split already present in the product:

```text
CONTEXT                         OPERATION
Identity / Access               Process
Current Enrollment              Evidence
Student Guide                   Next institutional action
```

The cut changes presentation only. It creates no new authority, state machine, persistence or API.

## Composition

Desktop:

```text
Student hero + operational guidance

┌──────────────────────┬─────────────────────────────────────┐
│ ACCESS               │ PROCESS                             │
│ QR / credential      │ derived state                      │
│                      │ milestones                          │
├──────────────────────┤ evidence                            │
│ CURRENT ENROLLMENT   │ next action                         │
│ service/category     │ owner-domain mutation controls      │
│ RENACH/opened at     │                                     │
├──────────────────────┤                                     │
│ STUDENT GUIDE        │                                     │
│ preview/generation   │                                     │
│ version history      │                                     │
└──────────────────────┴─────────────────────────────────────┘

Enrollment history and Audit history remain full-width below the active workspace.
```

The operational column is intentionally wider than the context rail. The workspace no longer assumes a 50/50 split between information and operation.

## Student Guide

`AdminStudentGuides` no longer participates visually as the tail of the Process column. It is projected into the contextual rail and retains the accepted DOCS-001 contract:

- same Enrollment inputs;
- same immutable generation;
- same digest;
- same modal document viewer;
- same print projection;
- no new persistence.

## Current Enrollment

The rail projects the currently active Enrollment, falling back to the paused operational Enrollment when necessary. It displays only already admitted facts:

- service;
- category;
- status;
- RENACH when present;
- opened date.

No editable status or `current_step` is introduced.

## Responsive law

Desktop prioritizes simultaneous context + operation.

On narrower screens the order becomes:

```text
Operational guidance
Process
Access
Current Enrollment
Student Guide
History
```

This keeps the next institutional action ahead of ancillary document operations.

## Invariants

- no DB migration;
- no API change;
- no ProcessResolver change;
- no Lesson/Exam/Access authority change;
- no task table;
- no `current_step`;
- histories remain projections of existing institutional facts;
- Student Guide remains DOCS-001 snapshot/receipt infrastructure.

## Admission

The cut may merge after the inherited CI passes, including frontend/server TypeScript, operational witnesses, deployment image and runtime smoke.
