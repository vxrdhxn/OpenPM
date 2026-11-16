-- Rollback of 018_notifications.sql (deletes every notification and mention record).
DROP TABLE IF EXISTS comment_mentions;
DROP TABLE IF EXISTS notifications;
