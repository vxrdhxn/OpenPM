-- Rollback of 014_task_search_indexes.sql
CREATE INDEX IF NOT EXISTS idx_projects_org_created ON projects (org_id, created_at DESC);
DROP INDEX IF EXISTS idx_projects_org_created_id;
DROP INDEX IF EXISTS idx_tasks_org_assignee;
DROP INDEX IF EXISTS idx_tasks_org_due;
DROP INDEX IF EXISTS idx_tasks_org_updated;
DROP INDEX IF EXISTS idx_tasks_org_created;
