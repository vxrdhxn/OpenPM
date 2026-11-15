-- Rollback of 010_invite_token_hash.sql
-- Hashes cannot be turned back into tokens, so outstanding invites are deleted (admins re-invite).
DELETE FROM organization_invites;
ALTER INDEX idx_org_invites_token_hash RENAME TO idx_org_invites_token;
ALTER TABLE organization_invites RENAME COLUMN token_hash TO token;
