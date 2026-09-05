-- ACCESS-002 — QR First Activation
-- A new Student has identity + Enrollment + QR before any password exists.
-- StudentCredential is materialized only when the Student activates the current QR.

ALTER TABLE student_access_qrs
  ADD COLUMN activated_at timestamptz;

-- Compatibility: students that already had credentials before ACCESS-002 are considered activated.
-- Use the QR creation timestamp as the institutional cutover time; do not invent an older activation fact.
UPDATE student_access_qrs q
SET activated_at = q.created_at
WHERE q.activated_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM student_credentials c
    WHERE c.student_id = q.student_id
  );

CREATE INDEX student_access_qrs_activation_idx
  ON student_access_qrs(student_id, activated_at)
  WHERE revoked_at IS NULL;
