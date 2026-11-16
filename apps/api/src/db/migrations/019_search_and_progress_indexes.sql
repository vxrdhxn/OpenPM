-- Indexes from the Phase 9 load test (docs/load-testing.md), measured on 50,000 tasks:
--
-- 1. Text search (`q`) uses ILIKE '%term%', which a B-tree cannot serve: a term that matches little
--    scanned every task of the organization (122 ms). Trigram GIN indexes let Postgres find the
--    candidate rows directly. pg_trgm is a trusted extension (Postgres 13+), so the database owner
--    can enable it; it is available on the common managed services.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON tasks USING gin (description gin_trgm_ops);

-- 2. The dashboard picks the most recently active projects by their latest task update. With this
--    index that is one index lookup per project instead of aggregating every task (57 ms).
CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON tasks (project_id, updated_at DESC);
-- ...and its status counts for the chosen projects come from this index (57 ms -> 8 ms overall).
-- The same index serves the board: one bounded range scan per column (project, status, oldest
-- first), and the per-column totals.
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_created ON tasks (project_id, status, created_at, id);

-- 3. (org_id) alone is a prefix of idx_tasks_org_created/_updated/_assignee. Besides costing every
--    write, it lured the planner into walking the whole organization for per-project counts.
DROP INDEX IF EXISTS idx_tasks_org_id;
