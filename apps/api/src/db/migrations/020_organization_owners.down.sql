-- Owners promoted by the up migration stay owners: their earlier role is not recorded, and the
-- previous release handles owners already.
ALTER TABLE organization_invites DROP COLUMN declined_at;
ALTER TABLE organizations DROP COLUMN updated_at;
