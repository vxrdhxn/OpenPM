-- Task comments (Phase I). Plain text: the API stores and returns the text as written and the
-- frontend renders it as text (never as HTML), so there is nothing to sanitize.
--
-- author_id has no cascade on purpose: users are deactivated, never deleted (migration 013), so a
-- removed member's comments stay, attributed to them. Comments go with their task (and so with
-- their project and organization).
CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set when the author edits the text; shown as "edited".
  edited_at TIMESTAMP WITH TIME ZONE
);

-- A task's thread, newest first, paged by (created_at, id).
CREATE INDEX idx_task_comments_task ON task_comments (task_id, created_at DESC, id DESC);
