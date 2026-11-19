-- Due-date reminders (docs/notifications.md). The worker notifies a task's assignee once the task is
-- due within 24 hours. due_reminder_sent_for records the due date that was reminded about, so each
-- due date is reminded once, and moving the due date earns a new reminder.
ALTER TABLE tasks ADD COLUMN due_reminder_sent_for TIMESTAMP WITH TIME ZONE;

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon'));

-- The sweep looks for open tasks with a due date; only those are indexed.
CREATE INDEX idx_tasks_due_open ON tasks (due_date) WHERE due_date IS NOT NULL AND status <> 'done';
