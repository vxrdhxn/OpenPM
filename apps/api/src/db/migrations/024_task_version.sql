-- Optimistic concurrency for task edits (docs/concurrency.md). Every update bumps
-- the version; a PATCH that names the version it was based on is refused with 409 if the task has
-- moved on since, instead of silently overwriting someone else's change.
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
