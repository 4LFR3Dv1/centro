# UX-006 — Zero-Training Witness

Status: REPEATABLE ACCEPTANCE WITNESS
Parent: #64
Workpack: #70
Depends on: UX-001..UX-005

## Purpose

Prove that Centro can be used consistently by someone who understands the work of a driving school but has never learned the software.

This witness tests the presentation contract. It does not replace domain tests for Enrollment, Process, Schedule, Exams or Access.

## Witness persona

### Staff operator

Knows how a driving school operates. Does not know:

- Centro's data model;
- ProcessResolver;
- domain ownership;
- internal state codes;
- API names;
- implementation terminology.

### Student

Knows only the ID/QR and information delivered by the school. Has received no tutorial for Centro.

## Acceptance vocabulary

At any decision point the interface must make one of these meanings obvious:

- **ACTION** — I can or must do something now;
- **WAIT** — nothing is required from me now;
- **BLOCKED** — something concrete prevents progress and I can identify what;
- **DONE** — this context has no pending action.

## Staff witness

### W1 — Find a student

Given the operator has any one of name, ID Centro, CPF, document, phone, e-mail or Student QR,
when they open `/admin/alunos`,
then they can find and open the correct student without knowing internal identifiers.

Pass conditions:
- search explains accepted inputs;
- QR scanner has manual fallback;
- stale QR warns and still routes to the current student record;
- CTA names the task rather than a generic `Open` action.

### W2 — Create an enrollment

Given a new or existing student,
when the operator opens `/admin/matriculas/nova`,
then the form asks questions in real-world language.

Pass conditions:
- service asks `O que o aluno vai fazer?`;
- current situation asks `Em que ponto este aluno está?`;
- RENACH requirement is contextual;
- submit action is `Criar matrícula`;
- no state-machine or implementation vocabulary is required.

### W3 — Deliver first access

Given enrollment creation succeeds,
when the receipt appears,
then the operator can identify exactly what to give the student.

Pass conditions:
- QR is visibly the student's access QR;
- UI says the student creates their own password;
- Staff is not shown or asked to create the password;
- operator can copy, print or open the student;
- activation pending vs active is understandable.

### W4 — Understand the student's next step

Given a student has an active or paused enrollment,
when the operator opens the student,
then the Process card states the next situation in human language.

Pass conditions:
- ACTION, WAIT, BLOCKED or DONE meaning is explicit;
- primary CTA names the exact effect;
- waiting explicitly says when no action is required;
- blocked states name the missing dependency;
- no implementation authority is created by the presentation.

### W5 — Schedule a lesson

Given the student is ready for practice,
when Staff chooses `Agendar aula`,
then they can choose date/time, instructor and vehicle without understanding the scheduling implementation.

Pass conditions:
- invalid/missing resources explain what is missing;
- action is `Agendar aula`;
- existing Schedule authority still rejects conflicts;
- after success the student's next step refreshes.

### W6 — Record exam state

Given a theory or practical exam requires Staff action,
when the contextual dialog opens,
then Staff can distinguish:

1. schedule exam;
2. attendance;
3. result informed to the school;
4. official result.

Pass conditions:
- buttons name the real-world effect;
- official and pre-official result are not conflated;
- dialog does not expose internal authority IDs/names;
- Escape closes the dialog and focus returns to the invoker.

### W7 — Operate from Home

Given `/admin` has current operational state,
when Staff opens Home,
then they can distinguish:

- happening now;
- next 24h;
- needs resolution;
- can act now;
- waiting/no action;
- first access pending.

Pass conditions:
- raw service/state codes are not shown;
- waiting items do not look like urgent work;
- each actionable row has an effect-specific CTA.

## Student witness

### W8 — First access from QR

Given a Student has not activated access,
when they scan the active QR,
then they understand that they must create their own password.

Pass conditions:
- 12-character requirement is visible;
- password confirmation mismatch is understandable;
- activation CTA says `Criar senha e entrar`;
- invalid QR offers manual ID login as recovery.

### W9 — Understand Home

Given the Student is authenticated,
when `/aluno` opens,
then they can answer:

- what needs my attention now?
- what is my next lesson?
- is an exam scheduled?
- do I need to do anything?

Pass conditions:
- generic `Abrir` CTA is not used for known actions;
- no-action state explicitly says `Você não precisa fazer nada agora`.

### W10 — Understand the journey

Given the Student opens `/aluno/processo`,
then they see `Etapas`, not an implementation model.

Pass conditions:
- completed/current/future states are visually and textually distinct;
- current step says `Esta é sua etapa atual`;
- unsupported service explains that step-by-step tracking is unavailable instead of exposing model internals.

### W11 — Agenda and exams

Given lessons/exams exist,
when the Student opens Agenda or Exams,
then they can understand commitments and results without Staff explanation.

Pass conditions:
- schedule changes are described as school updates;
- pending official result says no Student action is required;
- technical reconciliation/projection language is absent.

### W12 — Account recovery context

Given the Student opens Conta,
then password and connected-device actions are understandable without session/version terminology.

Pass conditions:
- password rule is visible;
- success/error messages explain outcome;
- `Sair dos outros dispositivos` explains the effect.

## Keyboard / assistive witness

Repeat W1, W3, W5, W6, W8 and W12 without a mouse.

Pass conditions:
- every control is keyboard reachable;
- visible focus is always present;
- icon-only close controls have accessible names;
- dialogs close with Escape where implemented and return focus;
- async errors/status changes use alert/status/live semantics;
- state is never communicated by color alone;
- reduced-motion preference removes meaningful animation dependency.

## Regression guard

Run:

```bash
npm run ux:language:check
```

The guard scans user-facing source text for implementation vocabulary banned by UX-001. A violation fails CI and points back to the language constitution.

## Final acceptance

The program is accepted when:

1. the automated language guard passes;
2. inherited TypeScript/tests/build pass;
3. this witness is repeatable without external product documentation;
4. no new workflow/domain authority was introduced to achieve the UX.