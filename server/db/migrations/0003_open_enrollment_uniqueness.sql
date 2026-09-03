-- ADMIN-002 / C4R — One open enrollment per Student/service/category
-- Historical completed/cancelled enrollments may repeat. ACTIVE or PAUSED
-- represent one continuing institutional relationship and cannot be duplicated.

CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_open_per_service_category
ON enrollments(student_id, service_type, category)
WHERE status IN ('ACTIVE', 'PAUSED');
