-- ADMIN-002 / C1R — Audit actor preservation reconciliation
-- ADMIN-001 used ON DELETE SET NULL for audit actors while simultaneously
-- requiring actor IDs for STUDENT/STAFF actor types. Those laws contradict.
-- Audit history must preserve actor referential identity, so deletion is RESTRICT.

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_student_id_fkey;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_student_id_fkey
  FOREIGN KEY (actor_student_id) REFERENCES students(id) ON DELETE RESTRICT;

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_staff_user_id_fkey;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_staff_user_id_fkey
  FOREIGN KEY (actor_staff_user_id) REFERENCES staff_users(id) ON DELETE RESTRICT;
