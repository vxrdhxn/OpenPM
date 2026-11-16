-- The organization activity feed (GET /api/activity, the dashboard): newest first, keyset-paged by
-- (created_at, id) within one organization. Replaces the plain org_id index, which this covers.
CREATE INDEX IF NOT EXISTS idx_activity_log_org_created ON activity_log (org_id, created_at DESC, id DESC);
DROP INDEX IF EXISTS idx_activity_log_org_id;
