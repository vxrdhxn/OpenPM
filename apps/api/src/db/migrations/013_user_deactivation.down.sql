-- Rollback of 013_user_deactivation.sql. Removed members stay unusable: their email is a placeholder
-- and their password hash is empty, so they cannot sign in even without deactivated_at.
DROP INDEX IF EXISTS idx_users_org_active;
ALTER TABLE users DROP COLUMN deactivated_at;
