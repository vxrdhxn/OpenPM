-- Rollback of 008_query_indexes.sql: drop the new indexes, restore the ones it replaced.
DROP INDEX IF EXISTS idx_activity_log_user_id;
DROP INDEX IF EXISTS idx_password_reset_user_id;

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
DROP INDEX IF EXISTS idx_projects_org_created;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
DROP INDEX IF EXISTS idx_tasks_project_created;
