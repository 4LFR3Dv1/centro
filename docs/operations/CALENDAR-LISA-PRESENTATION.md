# Calendar presentation invariant

`/admin/agenda` uses FullCalendar v7 with the same app-owned presentation contract proven in Lisa: structural `skeleton.css` plus explicit class hooks supplied by the React renderer.

There is no compatibility shim that styles FullCalendar internal `.fc-*` classes. Centro owns one implementation in `src/admin-calendar.tsx` + `src/admin-calendar.css`.

Domain authority remains unchanged: `Lesson` and `PracticalExamSession` are the sources of truth; the calendar is a projection and mutation surface only.
