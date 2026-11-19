-- Rollback of 024_task_version.sql: task edits are last-write-wins again.
ALTER TABLE tasks DROP COLUMN version;
