-- Rollback of 011_password_reset_token_hash.sql
-- Hashes cannot be turned back into tokens, so outstanding reset links are deleted (users request a
-- new one; they expire after an hour anyway).
DELETE FROM password_reset_tokens;
ALTER INDEX idx_password_reset_token_hash RENAME TO idx_password_reset_token;
ALTER TABLE password_reset_tokens RENAME COLUMN token_hash TO token;
