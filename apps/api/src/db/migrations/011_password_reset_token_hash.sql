-- Store only a SHA-256 hash of each password-reset token (same scheme as invites, migration 010).
-- The raw token exists only in the emailed link. Existing tokens are hashed in place so outstanding
-- links keep working until they expire.
ALTER TABLE password_reset_tokens RENAME COLUMN token TO token_hash;
UPDATE password_reset_tokens SET token_hash = encode(sha256(convert_to(token_hash, 'UTF8')), 'hex');
ALTER INDEX idx_password_reset_token RENAME TO idx_password_reset_token_hash;
