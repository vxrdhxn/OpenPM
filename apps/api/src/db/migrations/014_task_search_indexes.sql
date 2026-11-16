-- Indexes for task search and the paginated project list (Phase I).
-- GET /api/tasks is always scoped to one organization and sorted by one of these columns; the
-- trailing id matches the keyset tiebreak, so a page is an index range scan.
CREATE INDEX IF NOT EXISTS idx_tasks_org_created ON tasks (org_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_updated ON tasks (org_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_due ON tasks (org_id, due_date, id) WHERE due_date IS NOT NULL;
-- "Assigned to me" within an organization.
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee ON tasks (org_id, assignee_id);
-- Projects: newest first with the id tiebreak (replaces the (org_id, created_at DESC) index).
CREATE INDEX IF NOT EXISTS idx_projects_org_created_id ON projects (org_id, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_projects_org_created;
