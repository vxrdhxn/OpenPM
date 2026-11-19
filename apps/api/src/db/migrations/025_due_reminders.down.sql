-- Rollback of 025_due_reminders.sql. Reminder notifications are deleted with the type.
DROP INDEX idx_tasks_due_open;
DELETE FROM notifications WHERE type = 'due_soon';
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_assigned', 'mentioned', 'commented', 'status_changed'));
ALTER TABLE tasks DROP COLUMN due_reminder_sent_for;
