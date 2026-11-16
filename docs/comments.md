# Task comments

Each task has a discussion thread at `/api/projects/:projectId/tasks/:taskId/comments`. The task must
belong to that project, and both must belong to the caller's organization; otherwise the answer is 404.

| Action | Route | Who |
|---|---|---|
| Read | `GET .../comments` | everyone in the organization |
| Post | `POST .../comments` `{ body }` | members and above |
| Edit | `PATCH .../comments/:commentId` `{ body }` | the author only |
| Delete | `DELETE .../comments/:commentId` | the author, or an admin/owner (moderation) |

- **Text:** 1-10,000 characters, at least one of them not whitespace. Comments are plain text: the
  API stores them exactly as written, and the frontend renders them as text (never as HTML), so
  markup in a comment is shown, not run. There is no Markdown or @mention support yet.
- **Listing:** newest first, paginated like the other lists (`limit`, `cursor`, `{ items, next_cursor }`;
  see `docs/pagination.md`). The task dialog shows the newest page with the latest comment at the
  bottom, and loads earlier ones with "Show earlier comments".
- **Edits** set `edited_at`, which shows as "(edited)".
- **Removed members:** their comments stay, with `author_removed: true` ("(removed)" in the UI).
- **Deleting a task** deletes its comments.
- **Audit:** `activity_log` gets `entity_type = 'comment'` with `created`, `updated` or `deleted`. The
  metadata holds the task id (and, for deletes, the author and whether it was moderated), never the text.

## Live events

Published on the organization's channel (the same `/ws` socket as task events):

| `type` | Payload |
|---|---|
| `comment_created` | `project_id`, `task_id`, `comment` (the full comment) |
| `comment_updated` | `project_id`, `task_id`, `comment` |
| `comment_deleted` | `project_id`, `task_id`, `comment_id` |

An open task dialog applies them directly (`applyCommentEvent` in `apps/frontend/src/lib/comments.ts`).
Applying them is idempotent: your own post arrives both in the response and as an event. Events sent
while the socket was disconnected are not replayed; reopening the dialog reloads the thread.
