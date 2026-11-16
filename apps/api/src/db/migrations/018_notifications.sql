-- In-app notifications (Phase I). One row per recipient, written in the same transaction as the
-- change that caused it. `data` holds what the list needs to render without extra lookups (a task
-- title, a short comment excerpt); never secrets.
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the recipient
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,          -- who caused it
  type VARCHAR(32) NOT NULL
    CHECK (type IN ('task_assigned', 'mentioned', 'commented', 'status_changed')),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A user's list, newest first (keyset by created_at, id), and their unread count.
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Who a comment mentions, so editing a comment only notifies people who are newly mentioned.
CREATE TABLE comment_mentions (
  comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
