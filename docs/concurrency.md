# Concurrent edits

## Tasks: optimistic concurrency

Every task has a `version`, starting at 1 and bumped by every update (migration 024). A
`PATCH /api/projects/:projectId/tasks/:taskId` may include the version the edit was based on:

```json
{ "description": "New text", "version": 4 }
```

- If the task is still at version 4, the update applies and the response carries version 5.
- If someone changed it since, the answer is **409** with the current task, and nothing changes:

  ```json
  { "error": "Someone else changed this task while you were editing it", "task": { "id": "…", "version": 5, … } }
  ```

- Without `version`, the update applies to whatever is current (last write wins).

The check runs after the row is locked (`SELECT … FOR UPDATE`), so of two saves of the same version
exactly one succeeds. Tested in `apps/api/src/test/integration/concurrency.int.test.ts`.

### In the UI

The task dialog remembers the version the user started editing from and saves only the fields they
changed, with that version. Before this, a dialog with unsaved edits sent back stale values for fields
the user had not touched, silently reverting a teammate's change.

On a 409 the dialog keeps the user's edits, takes everything else from the current task, and asks
them to review and save again (`rebaseDraft` in `apps/frontend/src/lib/tasks.ts`). If both changed
the same field, the user's value is kept for review.

Dragging a card between columns sends only the new status, without a version: a move is a single
intent, and the latest one wins.

## Elsewhere

| What | Behavior |
| --- | --- |
| Projects, workspace settings | Last write wins. Edited rarely and by admins. |
| Comments | Only the author edits their own comment. |
| Task labels | `PUT` replaces the whole set with the task row locked. |
| Members, ownership, leaving | The organization row is locked, so the last owner/admin rules hold under races (`docs/members.md`). |
