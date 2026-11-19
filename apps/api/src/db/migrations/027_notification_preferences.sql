-- Notification preferences and retention (docs/notifications.md).
-- Each user can switch off notification types; muted types are never written for them (the check is
-- in the INSERT ... SELECT that creates notifications, and in the worker's due-date sweep).
ALTER TABLE users ADD COLUMN muted_notification_types TEXT[] NOT NULL DEFAULT '{}'
  CHECK (muted_notification_types <@ ARRAY['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon']::text[]);

-- The worker deletes notifications older than NOTIFICATION_RETENTION_DAYS, oldest first.
CREATE INDEX idx_notifications_created ON notifications (created_at);
