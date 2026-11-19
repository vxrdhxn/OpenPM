-- Object-storage deletions still owed (docs/attachments.md). Whenever attachment rows are deleted, their
-- storage keys are written here in the same transaction; the API deletes the objects after the commit
-- and removes the keys. Keys whose delete failed (or never ran: a crash, storage down) stay here, and
-- the API's storage sweep retries them. No foreign keys: the rows they came from are gone.
CREATE TABLE storage_deletions (
  storage_key VARCHAR(512) PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_storage_deletions_due ON storage_deletions (next_attempt_at);
