-- Store only a SHA-256 hash of each invite token. The raw token exists only in the emailed link, so a
-- database leak cannot be turned into working invite links. Existing tokens are hashed in place, so
-- outstanding invites keep working (sha256() is built into PostgreSQL 11+).
ALTER TABLE organization_invites RENAME COLUMN token TO token_hash;
UPDATE organization_invites SET token_hash = encode(sha256(convert_to(token_hash, 'UTF8')), 'hex');
ALTER INDEX idx_org_invites_token RENAME TO idx_org_invites_token_hash;
