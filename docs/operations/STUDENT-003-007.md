# STUDENT-003..007 — Student Experience Program

This program turns `/aluno` from a read-only status portal into the student-facing product while preserving a single institutional state.

## Laws

1. Student identity comes only from an Enrollment-backed session.
2. Browser-supplied `studentId` or `enrollmentId` is never authority.
3. Home, calendar, exam and journey are projections; they create no duplicate business state.
4. `Lesson` and `PracticalExamCandidate/Session` remain the calendar authorities.
5. Observed exam result is distinct from reconciled official result.
6. Process state remains derived from Enrollment + milestones + lessons. No mutable `current_step` is introduced.
7. Student security mutations affect only the authenticated Student and emit AuditEvent.
8. Password change preserves the current session and revokes other active Student sessions.

## Cuts

### STUDENT-003 — Student Experience Home

`GET /api/student/home` derives the primary action, next lesson, next practical exam, process progress and lesson summary.

### STUDENT-004 — Real Student Calendar

`GET /api/student/calendar?from=&to=` projects both Lesson and PracticalExamCandidate into one read-only FullCalendar surface. The student cannot drag, resize, select or mutate events.

### STUDENT-005 — Student Exam Experience

`GET /api/student/exams` and `GET /api/student/exams/:candidateId` are session-owned projections. A candidate belonging to another Student resolves as not found.

### STUDENT-006 — Process Journey 2.0

The existing ProcessResolver remains authoritative. The portal presents DONE / CURRENT / UPCOMING milestones and routes actionable current milestones to Agenda or Exam without inventing state.

### STUDENT-007 — Student Account / Security

`GET /api/student/security`, `POST /api/student/security/password` and `POST /api/student/security/sessions/revoke-others` expose self-service account security. Current password is required for password rotation; Argon2id remains the credential primitive; other sessions are revoked; audit actions are `STUDENT_PASSWORD_CHANGED` and `STUDENT_OTHER_SESSIONS_REVOKED`.

## Explicitly out of scope

- e-mail/SMS password recovery
- student-side lesson rescheduling
- student-side exam result mutation
- duplicate student task tables
- duplicate calendar-event persistence
