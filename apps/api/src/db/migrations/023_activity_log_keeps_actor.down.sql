-- Rollback of 023_activity_log_keeps_actor.sql: deleting a user erases their activity again.
ALTER TABLE activity_log DROP CONSTRAINT activity_log_user_id_fkey;
ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
