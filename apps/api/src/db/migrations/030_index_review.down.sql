-- Rollback of 030_index_review.sql. The dropped indexes come back under their old names, which the
-- rollbacks of migrations 011 and 010 rename.
CREATE INDEX idx_password_reset_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX idx_org_invites_token_hash ON organization_invites (token_hash);
CREATE INDEX idx_org_invites_org_id ON organization_invites (org_id);
CREATE INDEX idx_users_email ON users (email);
DROP INDEX idx_notifications_comment;
DROP INDEX idx_notifications_project;
DROP INDEX idx_notifications_task;
