# UX-007 — Operational Friction Audit

Status: BASELINE
Parent: #72
Workpack: #73
Baseline main: `41d09fa5fe42ba75773c34865384079a8ad11e19`

## Objective

Reduce unnecessary interaction cost without reducing institutional correctness.

Centro may remove a decision only when the answer is already known from accepted state. It may prefill a reversible value when compatibility is already proven. It must keep a decision when multiple institutionally valid outcomes remain.

## Friction budget model

For every critical flow, count:

- **R — route changes**: full navigation to another surface;
- **A — explicit actions**: clicks/submits required to complete the intended job;
- **D — required decisions**: values Staff/Student must choose because Centro cannot know them safely;
- **X — reconstructed context**: values the user is asked to reselect/re-enter even though Centro already knows them;
- **E — recovery exits**: recoverable errors that force the user out of the current context.

A lower number is not automatically better. Destructive confirmation, official-result distinction and category choice for an `AB` enrollment can be necessary friction.

## Baseline findings

### F1 — Contextual lesson scheduling is duplicated

Surfaces:
- `src/admin-today.tsx` — `HomeLessonScheduler`;
- `src/admin-operational-guidance.tsx` — `QuickLessonScheduler`.

Both already receive the student/enrollment/action context and both independently:

- load `/api/admin/schedule/options`;
- confirm the enrollment is schedulable;
- infer the next slot;
- filter instructors by category;
- filter vehicles by category;
- preselect the first compatible instructor and vehicle;
- POST the same lesson payload;
- dispatch `centro:process-changed`.

This does not currently create extra clicks, but it creates two interaction contracts for one job. Any future improvement must be implemented twice and may diverge.

**Priority: P0.** Consolidate into one presentation component. Authority remains `/api/admin/schedule/lessons`.

### F2 — Contextual scheduler already removes most reconstructable context

For a non-`AB` enrollment, Centro already supplies:

- `studentId`;
- `enrollmentId`;
- category;
- compatible resource lists;
- next slot candidate;
- default duration policy.

The user should not be asked for student/enrollment again. Current contextual schedulers correctly avoid that.

Remaining required decisions:

- date/time review/change;
- instructor review/change;
- vehicle review/change;
- duration review/change when operationally necessary.

The first compatible values are reversible defaults, not hidden decisions.

**Priority: preserve.** Do not regress to the generic scheduler.

### F3 — `AB` category is a real decision and must not be hidden

Both contextual schedulers currently initialize `AB` as category `B`, while still showing the category selector.

Because A and B can both be valid next lessons, Centro cannot infer which class the employee intends to schedule merely from `AB` enrollment state.

**Priority: P1 correctness.** Keep category visible and require an intentional A/B selection, or preselect only if a future owner-domain signal makes one category uniquely valid.

This is **necessary friction**, not a target for removal.

### F4 — Home and Student Detail already provide one-path execution for typed commands

`AdminToday` and `AdminOperationalGuidance` execute the existing `OperationalCommand` directly:

- URL commands navigate;
- schedule commands open contextual scheduling;
- other typed commands open `OperationalCommandDialog`.

No generic `/actions/execute` detour exists.

**Priority: preserve.** UX2 must improve context carryover without introducing a new executor.

### F5 — Enrollment receipt is already a strong completion surface

After enrollment creation, the receipt keeps the created student/enrollment context and offers:

- QR delivery;
- copy access link;
- copy student ID;
- print QR;
- `Ver aluno`;
- `Criar outra matrícula`.

No search/reselection is required before opening the newly created student.

**Priority: preserve.** The receipt is not a friction hotspot.

### F6 — Student Home already has direct object routes, but duplicates attention

`StudentHome` can route directly to:

- the `primaryAction.href`;
- `/aluno/agenda/:lessonId` for the next lesson;
- `/aluno/exame/:candidateId` for the next practical exam.

However, when `primaryAction` refers to the same next lesson/exam, the same commitment can compete in both `AGORA` and the secondary card grid.

**Priority: P1.** Suppress duplicate secondary emphasis when the primary action already targets that object. Preserve the secondary card as context only or remove its competing CTA.

### F7 — Search → student is already low-friction

The students surface accepts several identifiers and QR scanning. A result row opens Student Detail directly.

Baseline:

- text search: `A=2` (submit + choose result), `R=1`, `X=0`;
- QR: `A≈2` (open scanner + resolve), `R=1`, `X=0`.

**Priority: preserve.** Do not add intermediate profile-selection screens.

## Baseline budgets

| Flow | R | A | D | X | E | Assessment |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Home → typed next action | 0–1 | 1 + operation | domain-dependent | 0 | 0 | good |
| Student Detail → typed next action | 0 | 1 + operation | domain-dependent | 0 | 0 | good |
| Ready for practice → contextual lesson | 0 | 2 (open + submit) | 3–4 | 0 | 0 | good, duplicated implementation |
| Find student by search | 1 | 2 | 1 | 0 | 0 | good |
| Find student by QR | 1 | ≈2 | 0 | 0 | 0 | good |
| Enrollment → access → student | 0–1 | 1 after creation | 0 | 0 | 0 | good |
| Student Home → primary action | 1 | 1 | 0 | 0 | 0 | good |
| Student Home → next lesson/exam | 1 | 1 | 0 | 0 | 0 | good, may duplicate primary emphasis |

## Ranked UX2 targets

1. **P0 — one contextual lesson scheduler** shared by Home and Student Detail;
2. **P1 — make `AB` category an explicit intentional decision rather than an arbitrary default**;
3. **P1 — remove duplicate Student Home emphasis when primary action already targets the same commitment**;
4. **P1 — standardize completion callbacks so contextual operations refresh and return to the invoking context**;
5. **P2 — add a repeatable friction witness and source guard for duplicated contextual scheduler implementations**.

## Authority boundary

UX2 may change:

- presentation composition;
- component reuse;
- defaults that are visible/reversible;
- local navigation/context carryover;
- success/recovery behavior.

UX2 must not change:

- Process fact ownership;
- Schedule conflict/category rules;
- theory/practical result authority;
- Access activation/security authority;
- Enrollment state semantics.

## Acceptance delta target

The first cut is accepted when:

- contextual lesson scheduling has one implementation;
- no known student/enrollment is reselected;
- `AB` requires an intentional category choice;
- Student Home does not present duplicate competing CTAs for the same immediate object;
- recoverable contextual errors do not force route exits;
- the friction witness can be repeated on future PRs.
