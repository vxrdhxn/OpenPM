-- File attachments on tasks. The bytes live in S3-compatible object storage; this table holds
-- metadata and the authorization anchor (org_id) for every download/delete.
--
-- Lifecycle: a row is created 'pending' when an upload URL is issued and becomes 'ready' once the
-- API has verified the uploaded object. Pending rows that are never completed are orphans and can
-- be reaped by age (see idx_task_attachments_pending).
CREATE TABLE task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  filename VARCHAR(255) NOT NULL,            -- sanitized display name only; never used in the storage key
  content_type VARCHAR(127) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  storage_key VARCHAR(512) NOT NULL UNIQUE,  -- randomized, e.g. org/<org>/tasks/<task>/<uuid>
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_task_attachments_task_id ON task_attachments(task_id);
CREATE INDEX idx_task_attachments_org_id ON task_attachments(org_id);
-- Orphan cleanup scans only abandoned uploads.
CREATE INDEX idx_task_attachments_pending ON task_attachments(created_at) WHERE status = 'pending';
