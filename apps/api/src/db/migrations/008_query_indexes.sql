-- Indexes backed by actual query patterns (see routes/tasks.ts, projects.ts, auth.ts).
-- Plain CREATE INDEX (not CONCURRENTLY): the migration runner wraps each file in a
-- transaction, and these tables are small at this stage.

-- Task board: WHERE project_id = $1 AND org_id = $2 ORDER BY created_at.
-- Supersedes idx_tasks_project_id (same leading column).
CREATE INDEX IF NOT EXISTS idx_tasks_project_created ON tasks(project_id, created_at);
DROP INDEX IF EXISTS idx_tasks_project_id;

-- Project list: WHERE org_id = $1 ORDER BY created_at DESC.
-- Supersedes idx_projects_org_id (same leading column).
CREATE INDEX IF NOT EXISTS idx_projects_org_created ON projects(org_id, created_at DESC);
DROP INDEX IF EXISTS idx_projects_org_id;

-- Foreign-key lookups: DELETE ... WHERE user_id = $1 on reset, and ON DELETE CASCADE from users.
CREATE INDEX IF NOT EXISTS idx_password_reset_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
