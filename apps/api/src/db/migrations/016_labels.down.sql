-- Rollback of 016_labels.sql (deletes every label and assignment).
DROP TABLE IF EXISTS task_labels;
DROP TABLE IF EXISTS labels;
