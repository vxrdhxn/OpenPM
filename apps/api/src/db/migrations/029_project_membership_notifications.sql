-- Notifications when someone adds you to a project or removes you from one (docs/notifications.md).
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon', 'project_added', 'project_removed'));

ALTER TABLE users DROP CONSTRAINT users_muted_notification_types_check;
ALTER TABLE users ADD CONSTRAINT users_muted_notification_types_check
  CHECK (muted_notification_types <@ ARRAY['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon',
                                           'project_added', 'project_removed']::text[]);
