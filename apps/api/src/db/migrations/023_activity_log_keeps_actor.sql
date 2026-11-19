-- Users are never deleted, only deactivated (docs/members.md), and every column that records who did
-- something refuses a user delete (NO ACTION) so history cannot vanish. activity_log.user_id was the
-- exception: ON DELETE CASCADE would have silently erased a person's activity. It now matches the
-- others. Deleting a whole organization still works: its users and their activity go in the same
-- statement, and NO ACTION is checked at the end of it. Policy: docs/data-deletion.md.
ALTER TABLE activity_log DROP CONSTRAINT activity_log_user_id_fkey;
ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
