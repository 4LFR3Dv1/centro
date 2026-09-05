# UX-017 — Exception-First Operations Witness

Status: REPEATABLE ACCEPTANCE WITNESS
Parent: #79
Workpack: #85
Depends on: UX-012..UX-016

## Purpose

Prove that known operational exceptions remain understandable and recoverable without inventing a second business authority.

The witness tests presentation and recovery routing. Owner-domain tests remain authoritative for whether a mutation is legal.

## Core assertion

For every exception, the user can answer:

1. what happened;
2. what changed or is blocked;
3. who must act;
4. the safest valid next action;
5. what remains true after recovery.

## W1 — Student scheduling conflict

Given Staff opens contextual lesson scheduling with student + enrollment already known,
when the Schedule owner rejects the attempted window because the student already has a lesson,
then:

- the attempted form values remain visible;
- the UI says the student already has a lesson in that window;
- Staff is told to choose another time;
- no lesson is silently moved or created.

## W2 — Instructor / vehicle conflict

When Schedule rejects the instructor or vehicle window,
then:

- the conflicting resource is named;
- Staff changes only time/resource as needed;
- known student/enrollment/category context remains;
- the same Schedule endpoint is retried.

## W3 — Missing compatible resource

Given a category has no authorized instructor and/or active vehicle,
then:

- the missing dependency is stated before submission when options make it knowable;
- submit remains impossible without required compatible resources;
- no incompatible resource is auto-selected.

## W4 — Lesson no-show

Given a scheduled lesson is resolved as `NO_SHOW`,
then:

- the original lesson remains resolved as a historical occurrence;
- it does not count as completed practice;
- operational guidance says the last lesson ended as a no-show;
- the recovery command is `SCHEDULE_LESSON` for a **new** lesson.

## W5 — Lesson cancellation

Given a lesson is resolved as `CANCELLED`,
then:

- the cancelled occurrence is not reopened;
- the UI says the old time is no longer committed;
- if practice still continues, Staff receives `Agendar nova aula` through Schedule ownership.

## W6 — Theory exam absence

Given attendance is recorded as absent,
then:

- the attempt resolves without an exam result;
- the next Staff projection says the previous attempt ended as absence;
- the recovery is a new theory attempt through THEORY-EXAM-001;
- Student Home says the school needs to arrange the next attempt and exposes no Staff control.

## W7 — Theory exam official failure

Given the official result is failed,
then:

- the failed attempt remains evidence;
- Staff sees why a new attempt is needed;
- Student sees the official failure without being asked to perform a school-owned scheduling action.

## W8 — Practical exam absence

Given a practical candidate is absent,
then:

- no result is recorded for that attempt;
- while the current list still owns the occurrence, guidance points Staff to finish that list;
- after the list no longer owns an open candidate, the next action can become a new practical attempt;
- the old absence remains in exam history.

## W9 — Observed / official divergence

Given the school-informed result differs from the official result,
then:

- both values remain visible;
- the UI explicitly calls out the difference;
- the official value is identified as the value that guides process progression;
- the school-informed value is not overwritten.

## W10 — Official rejection

Given an official practical result is failed,
then:

- the attempt is displayed as officially failed;
- no successful milestone is fabricated;
- a new-attempt path appears only through the existing Exam owner.

## W11 — Paused enrollment

Given an enrollment is paused,
then:

- ordinary process actions do not compete with the pause;
- Staff sees that progression is stopped;
- the interface does not invent a reactivation endpoint if none is supported;
- Student Home says the school must resolve it and does not show a Staff-owned CTA.

## W12 — Stale/replaced QR

Given a student opens a replaced or unavailable QR,
then:

- the QR does not authenticate the student;
- UI explains that it is no longer current;
- an already-activated student can fall back to ID + password;
- a not-yet-activated student is told to request the current QR.

## W13 — Temporarily locked access

Given access is locked until a future time,
then:

- the UI says when another attempt becomes possible;
- it does not imply that Staff knows or resets the student's password;
- waiting is distinct from administrative disablement.

## W14 — Disabled access

Given access is disabled,
then:

- the UI states that school intervention is required;
- password/session internals are not exposed;
- ACCESS-002 remains the authority.

## Regression budget

A change fails UX3 admission if it:

- removes the shared ExceptionGuidance presentation primitive from contextual scheduling;
- collapses lesson no-show/cancel recovery to generic scheduling copy;
- collapses exam absence/failure to generic scheduling copy;
- hides observed-vs-official divergence;
- removes safe stale-QR fallback;
- gives Student Home a clickable primary control for `WAIT_*` or `SCHOOL_*` states;
- introduces a generic exception-resolution endpoint or new persisted exception workflow.

## Admission

UX3 is accepted only when:

- `npm run ux:language:check` passes;
- `npm run ux:friction:check` passes;
- `npm run ux:exceptions:check` passes;
- inherited operational tests pass;
- frontend/server builds pass;
- deployment image and smoke pass.
