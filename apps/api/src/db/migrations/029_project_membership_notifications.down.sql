-- Rollback of 029_project_membership_notifications.sql. Those notifications and preferences are dropped.
DELETE FROM notifications WHERE type IN ('project_added', 'project_removed');
UPDATE users SET muted_notification_types = array_remove(array_remove(muted_notification_types, 'project_added'), 'project_removed');
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon'));
ALTER TABLE users DROP CONSTRAINT users_muted_notification_types_check;
ALTER TABLE users ADD CONSTRAINT users_muted_notification_types_check
  CHECK (muted_notification_types <@ ARRAY['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon']::text[]);
