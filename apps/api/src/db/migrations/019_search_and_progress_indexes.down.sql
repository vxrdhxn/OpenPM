-- Rollback of 019_search_and_progress_indexes.sql. The pg_trgm extension is left installed (other
-- objects may use it, and dropping it needs more privileges than creating it).
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON tasks (org_id);
DROP INDEX IF EXISTS idx_tasks_project_status_created;
DROP INDEX IF EXISTS idx_tasks_project_updated;
DROP INDEX IF EXISTS idx_tasks_description_trgm;
DROP INDEX IF EXISTS idx_tasks_title_trgm;
