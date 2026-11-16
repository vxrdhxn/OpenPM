-- Rollback of 012_user_token_version.sql (sessions can no longer be revoked).
ALTER TABLE users DROP COLUMN token_version;
