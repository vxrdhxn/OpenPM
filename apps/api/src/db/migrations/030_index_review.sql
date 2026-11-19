-- Index review (November 2026), from the schema itself (docs/database-access.md, "Indexes"):
--
-- 1. Deleting a task, project or comment cascades to notifications, the table that grows fastest, by
--    task_id, project_id and comment_id. Those columns had no index, so every such delete scanned
--    all notifications. Partial indexes: most notifications have no comment, some no project.
CREATE INDEX idx_notifications_task ON notifications (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_notifications_project ON notifications (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_notifications_comment ON notifications (comment_id) WHERE comment_id IS NOT NULL;

-- 2. Four indexes duplicated the index Postgres already keeps for a UNIQUE constraint on the same
--    leading column, so every write maintained the same index twice.
DROP INDEX idx_users_email;                 -- users_email_key
DROP INDEX idx_org_invites_org_id;          -- organization_invites_org_id_email_key (org_id, email)
DROP INDEX idx_org_invites_token_hash;      -- organization_invites_token_key (token_hash)
DROP INDEX idx_password_reset_token_hash;   -- password_reset_tokens_token_key (token_hash)
