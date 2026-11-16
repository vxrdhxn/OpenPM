-- Rollback of 017_activity_feed_index.sql
CREATE INDEX IF NOT EXISTS idx_activity_log_org_id ON activity_log (org_id);
DROP INDEX IF EXISTS idx_activity_log_org_created;
