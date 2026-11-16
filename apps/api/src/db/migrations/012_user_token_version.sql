-- Session revocation (H.3). Every session JWT carries the user's token_version at sign-in (claim
-- `tv`); authentication rejects a token whose version no longer matches. Bumping the column ends
-- all of the user's sessions at once: password reset, password change and logout do this.
-- Existing tokens have no `tv`, which counts as 0, so sessions issued before this migration stay
-- valid until their first revocation or expiry.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
