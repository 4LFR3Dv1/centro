# UX-011 — Friction Witness

Status: REPEATABLE ACCEPTANCE WITNESS
Parent: #72
Workpack: #77
Baseline: UX-007

## Purpose

Prove that a UX simplification actually removes unnecessary work without deleting decisions that protect institutional correctness.

This witness complements `UX-006-ZERO-TRAINING-WITNESS.md`:

- UX-006 asks whether the correct action is understandable;
- UX-011 asks whether reaching and completing that action contains avoidable friction.

## Budget notation

- `R` — route changes;
- `A` — explicit actions/clicks/submits;
- `D` — required human decisions;
- `X` — known context reconstructed by the user;
- `E` — recoverable error exits from the current context.

## W1 — Home → contextual lesson

### Given

An attention item on Admin Home says the student can start/continue practical lessons.

### When

Staff chooses `Agendar aula`.

### Then

The contextual scheduler opens directly with:

- student already known;
- enrollment already known;
- non-AB category already known;
- next time slot suggested;
- compatible instructor suggested when available;
- compatible vehicle suggested when available;
- duration suggested from Schedule policy.

### Budget

Target: `R=0`, `A=2` (open + submit), `X=0`.

The remaining decisions are legitimate review/choice, not reconstructed context.

## W2 — Student Detail → contextual lesson

Same contract as W1. The same shared component must be used.

Target: `R=0`, `A=2`, `X=0`.

A future PR fails the friction contract if Student Detail grows a private scheduling form again.

## W3 — A+B category

### Given

The enrollment category is `AB`.

### Then

The scheduler must not silently decide A or B.

Expected:

- category begins unselected;
- Staff explicitly chooses A or B;
- only after that choice are compatible instructor/vehicle defaults shown;
- the selected category remains editable until submit.

This adds `D=1` intentionally.

**This decision is protected friction.** Removing it without a new owner-domain fact is a correctness regression.

## W4 — Resource absence

### Given

The selected category has no compatible instructor or vehicle.

### Then

The scheduler remains open and explains the missing dependency.

Target: `E=0`.

The operator may change category/time/context as applicable or close intentionally. A recoverable resource problem must not eject them to another route.

## W5 — Successful lesson scheduling

### When

Schedule accepts the lesson.

### Then

- the modal closes;
- `centro:process-changed` is emitted with the same student/enrollment context;
- the invoking Home/Student Detail view refreshes;
- no search or manual return navigation is required.

Target after submit: `R=0`, `X=0`.

## W6 — Student Home primary action

### Given

The Student Home `primaryAction.href` points to the same lesson displayed as `nextLesson`.

### Then

Only the primary block contains the competing action button. The lesson card remains useful context but does not repeat the same CTA.

The same rule applies to the next practical exam.

Target: one obvious immediate route for one immediate object.

## W7 — Necessary confirmations remain

The following friction must not be optimized away merely to reduce clicks:

- destructive/revocation confirmations;
- official vs observed exam-result distinction;
- A vs B choice for an AB lesson when both remain valid;
- authentication/password confirmation;
- Schedule conflict rejection;
- required identity/enrollment facts not derivable from current state.

## Deterministic guard

`npm run ux:friction:check` asserts that:

1. Admin Home and Student Detail both use `ContextualLessonScheduler`;
2. neither surface owns `/api/admin/schedule/options` or lesson POST logic;
3. AB does not silently default to B;
4. Student Home keeps duplicate-primary detection for lesson/exam.

This is intentionally a source-architecture guard. Domain correctness remains covered by the existing Schedule/Process/Exam/Access tests.

## Before / after budget

| Flow | Before | After | Delta |
| --- | --- | --- | --- |
| Home → contextual lesson | `R0 A2 X0`, duplicated implementation | `R0 A2 X0`, single implementation | same user cost, lower divergence risk |
| Detail → contextual lesson | `R0 A2 X0`, duplicated implementation | `R0 A2 X0`, single implementation | same user cost, lower divergence risk |
| AB lesson category | hidden initial B + editable selector | explicit A/B decision | +1 intentional decision, removes hidden assumption |
| Student Home same immediate lesson | primary CTA + secondary lesson CTA | primary CTA only | -1 competing action |
| Student Home same immediate exam | primary CTA + secondary exam CTA | primary CTA only | -1 competing action |

## Acceptance

UX2 is accepted when:

- the complete inherited CI is green;
- `ux:language:check` is green;
- `ux:friction:check` is green;
- TypeScript/build prove the shared scheduler integrations;
- W1–W7 remain true by source inspection and inherited domain tests;
- no migration/API/domain-authority delta was introduced.
