-- Rollback of 009_task_attachments.sql
-- NOTE: this removes metadata only; objects already uploaded to storage are not deleted.
DROP TABLE IF EXISTS task_attachments;
