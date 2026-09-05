# UX-009 — Smart Defaults Contract

Status: PRESENTATION CONTRACT
Parent: #72
Workpack: #75
Depends on: UX-007, UX-008

## Law

> A default may save a decision only when it is visible, reversible and compatible with accepted state.

## Contextual lesson scheduling

Centro already knows:

- student;
- enrollment;
- enrollment category when it is singular;
- Schedule slot policy;
- active instructors and their categories;
- active vehicles and their categories.

Therefore the contextual scheduler may safely suggest:

- the next valid slot boundary after the current time;
- the policy-compatible default duration closest to 60 minutes;
- the first active instructor compatible with the selected category;
- the first active vehicle compatible with the selected category.

Every suggestion remains visible and editable before submission.

## A+B exception

An `AB` enrollment does **not** make A or B uniquely correct for a specific lesson.

Therefore:

- the lesson category starts unselected;
- the operator explicitly chooses A or B;
- compatible instructor/vehicle suggestions are computed only after that choice;
- no future UI may silently reintroduce `AB -> B` or `AB -> A` without a new authoritative fact that makes the category unique.

## Authority boundary

Smart defaults never:

- create the lesson before Staff submits;
- bypass Schedule conflict checks;
- invent instructor/vehicle compatibility;
- persist a preference as institutional truth;
- mutate Process directly.

The Schedule endpoint remains the owner of lesson admission.

## Recovery

If a suggested resource becomes invalid by submit time, Schedule rejection remains authoritative. The contextual modal stays in place, displays the error, and allows correction without reconstructing student/enrollment context.

## Acceptance

A non-AB contextual lesson normally requires Staff to review/change only the facts Centro cannot know with certainty. An AB lesson adds exactly one protected decision: A or B.
