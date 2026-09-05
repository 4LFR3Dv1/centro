# UX-012 — Exception Taxonomy & Recovery Contract

Status: PRESENTATION CONTRACT
Parent: #79
Workpack: #80
Depends on: accepted CENTRO-UX2

## Objective

Centro must treat an operational exception as a known state that can be explained and, when the owning domain permits it, recovered from without making the user reconstruct internal state.

> An exception is not a failure of the interface. It is a state the interface must know how to explain and recover from.

This contract is presentation-only. It does not create a new exception engine, workflow authority or generic resolution endpoint.

## Boundary

```text
Schedule / Process / Exams / Enrollment / Access
                    |
                    | authoritative facts + invariant errors
                    v
          exception presentation adapter
                    |
                    v
          ExceptionGuidance
                    |
                    v
             Staff / Student
```

The owner domain remains the only place where recovery can mutate institutional state.

## Taxonomy

### CONFLICT

Two valid commitments cannot coexist.

Examples:
- student already has a lesson in that window;
- instructor already has another commitment;
- vehicle is already reserved.

Presentation law:
- name the conflicting resource/person;
- keep the attempted data in place;
- ask the user to change only the conflicting choice;
- never silently move the commitment.

### MISSING_DEPENDENCY

A required compatible resource or prerequisite is absent.

Examples:
- no instructor authorized for category B;
- no active vehicle for the category;
- required enrollment/process fact missing.

Presentation law:
- name what is missing;
- explain why it prevents the operation;
- link to the existing owner surface when recovery exists.

### ABSENCE

A person did not attend an expected lesson/exam.

Presentation law:
- state that the occurrence ended as an absence;
- explain what does not count as completed;
- expose the next valid attempt path only after the owning domain permits it.

### REJECTION

An authoritative result is negative.

Examples:
- official exam result = FAILED.

Presentation law:
- say the attempt ended with a negative official result;
- do not soften or reinterpret the fact;
- explain the next valid retry/continuation path when available.

### DIVERGENCE

Two independently recorded facts disagree.

Primary example:
- observed exam result != official exam result.

Presentation law:
- show both facts;
- say which source is authoritative for progression;
- retain the divergence as evidence;
- never silently overwrite the observed fact.

### PAUSED

The institutional object exists but progression is intentionally suspended.

Presentation law:
- say progression is stopped;
- identify who can resume it;
- never present ordinary next-step actions while paused.

### ACCESS_BLOCKED

Authentication/access cannot proceed temporarily or administratively.

Presentation law:
- distinguish timed lock from disabled access;
- say whether waiting or Staff intervention is required;
- never expose password hashes, credential versions or session internals.

### STALE_REFERENCE

The user has an old locator/reference, such as a replaced QR.

Presentation law:
- explain that the reference is no longer current;
- preserve identity recovery when safe;
- route to manual login or request the current QR;
- never authenticate from a stale locator alone.

## Actor model

Every exception must be classified by who can move it forward:

- `STAFF` — the school can act now;
- `STUDENT` — the student must act;
- `EXTERNAL` — Centro is waiting for Detran/external authority;
- `NONE` — the event is final and no recovery is currently required.

Primary UI must say this in human language. Internal actor codes do not need to be shown.

## Recovery contract

A complete exception presentation answers:

1. **What happened?**
2. **What does it block/change?**
3. **Who needs to act?**
4. **What is the safest valid next action?**
5. **What happens after recovery?**

When a recovery action is unavailable because the owning domain has no supported mutation, the UI must say that instead of pretending a CTA resolves it.

## Priority

For Staff attention ordering:

```text
recoverable BLOCKED/CONFLICT
    > missing dependency requiring Staff
    > result divergence requiring confirmation
    > ordinary ACTION_REQUIRED
    > external WAIT
    > DONE/final history
```

This priority is presentation only. It does not alter domain state.

## Destructive actions

Cancellation, removal, authoritative result confirmation and similar consequential actions keep explicit confirmation where required. UX3 does not optimize away correctness barriers.

## Student projection

Students see only the part of an exception relevant to them.

Examples:
- Staff-only conflict: `A escola precisa ajustar seu próximo horário. Você não precisa fazer nada agora.`
- stale QR: `Este QR não está mais ativo. Entre com seu ID e senha ou peça o QR atual à escola.`
- official failure: state the result and next expected step without exposing internal reconciliation terminology.

## Acceptance

For every exception surface ask:

1. Is the exception named in familiar work language?
2. Is the consequence explicit?
3. Is the responsible actor clear?
4. Does the recovery use the existing owner-domain action?
5. Is entered/known context preserved?
6. Is a waiting/final state clearly distinguished from something the user can fix?

If any answer is no, the exception presentation is incomplete.
