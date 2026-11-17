-- Rollback of 021_project_access.sql. Private projects become visible to the whole workspace again.
DROP TABLE project_members;
ALTER TABLE projects DROP COLUMN updated_at, DROP COLUMN visibility;
