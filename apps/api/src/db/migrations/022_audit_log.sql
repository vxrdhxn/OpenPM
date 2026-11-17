-- Security audit log (docs/audit-log.md): sign-ins, failed sign-ins, password changes and resets,
-- and changes to who can do or see what. Separate from activity_log, which is the product feed every
-- member reads; this one is for admins and owners only, records where a request came from, and is
-- pruned after AUDIT_RETENTION_DAYS.
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Who did it. Kept if the user row ever goes (SET NULL); members are normally only deactivated.
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32),
  target_id UUID,
  ip VARCHAR(64),
  user_agent VARCHAR(256),
  request_id VARCHAR(128),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The admin view pages newest first per organization; the retention sweep deletes by age.
CREATE INDEX idx_audit_log_org_created ON audit_log (org_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_log_created ON audit_log (created_at);
