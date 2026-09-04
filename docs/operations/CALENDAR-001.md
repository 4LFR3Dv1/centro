# CALENDAR-001 — Real Operational Calendar

## Status

Candidate implementation for the Staff operational calendar at `/admin/agenda`.

## Purpose

Replace the list-like agenda presentation with a real calendar surface while preserving the existing operational kernels as the only source of authority.

The calendar is a projection and interaction surface. It does not own lesson or exam state.

## Sources of truth

### Lessons

`Lesson` remains authoritative for practical lesson scheduling.

All create/reschedule/resolve requests continue through the existing Schedule API and Lesson Kernel. Student, instructor and vehicle conflicts are therefore still rejected before persistence.

### Practical exams

`PracticalExamSession` remains authoritative for practical exam rosters.

The calendar only projects exam sessions. CALENDAR-001 does not introduce calendar-owned copies of exam state and does not allow free drag/reschedule of an exam session.

## Surface

`/admin/agenda`

Desktop views:

- Month
- Week
- Day
- List

Compact/mobile defaults to Day, with List available. Month and Week controls are intentionally hidden in compact presentation to avoid compressing an unusable grid.

Locale is pt-BR. The operational policy continues to declare `America/Sao_Paulo`.

## Calendar projections

### Lesson event

A Lesson event projects:

- student name
- student public ID
- category
- instructor
- vehicle
- start/end
- status

Scheduled lessons are draggable/resizable. The gesture is not authoritative: it calls the existing reschedule endpoint. If the kernel rejects the mutation, FullCalendar reverts the gesture.

Clicking a lesson opens the operational inspector. Scheduled lessons retain actions for:

- reschedule
- complete
- no-show
- cancel

### Practical exam event

A practical exam event projects:

- category
- candidate count
- location/banca
- responsible instructor
- vehicle
- session status
- start/end

Exam events are read-only in the calendar. Clicking one routes the operator to the Exams surface.

## Creation

A Staff operator can create a lesson from either:

- `Nova aula`
- selecting a date/time range in the calendar

Selection only pre-fills the existing lesson editor. The actual mutation remains the Schedule API transaction.

## Filters

The surface can filter by:

- event type: lessons + exams / lessons / exams
- physical category
- instructor
- vehicle

Filtering is a projection concern and does not mutate domain state.

## Query window

The existing lesson list endpoint accepts at most 32 days per request. CALENDAR-001 preserves that backend contract by transparently splitting larger FullCalendar ranges into <=31-day chunks and deduplicating lessons by ID.

Exam queries use the EXAMS-001 range endpoint directly.

## Laws

1. Calendar state is not domain state.
2. A lesson drag is a reschedule request, never a local mutation.
3. A rejected Schedule Kernel mutation must revert the calendar gesture.
4. Practical exams are projected from `PracticalExamSession`; they are not duplicated into Lesson or calendar tables.
5. Exam sessions are not draggable in CALENDAR-001.
6. Existing Staff authentication and Origin gates remain unchanged.
7. Existing Lesson and Exam conflict laws remain authoritative.
8. Mobile presentation prioritizes a usable day/list surface over shrinking a desktop month grid.

## Deliberately out of scope

- recurring lessons
- direct Detran calendar integration
- drag/reschedule of practical exam sessions
- calendar-owned persistence
- arbitrary free-form events unrelated to operational primitives
