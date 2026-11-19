-- Rollback of 027_notification_preferences.sql: everyone gets every notification type again.
DROP INDEX idx_notifications_created;
ALTER TABLE users DROP COLUMN muted_notification_types;
