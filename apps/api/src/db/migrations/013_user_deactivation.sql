-- Member removal (Phase I). There is no membership table: a user belongs to exactly one organization,
-- so "removed from the organization" means the account is deactivated, not deleted. Deleting the row
-- is not an option: projects/tasks/attachments reference their creator (NOT NULL, no cascade), and
-- activity_log rows would be cascaded away, erasing the audit trail.
--
-- On removal the row becomes a tombstone: deactivated_at is set, the email is replaced with a
-- placeholder (so the address can be invited again), the password hash is cleared, token_version is
-- bumped (ending every session), and the name is kept so history still shows who did what.
ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMP WITH TIME ZONE;

-- Active members of an organization (member list, last-admin checks).
CREATE INDEX idx_users_org_active ON users (org_id) WHERE deactivated_at IS NULL;
