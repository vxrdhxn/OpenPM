# Labels

Labels belong to the **organization**: one set, used by every project. Names are unique within an
organization, ignoring case ("Bug" and "bug" are the same label), and are 1-50 characters.

| Action | Route | Who |
|---|---|---|
| List (with how many tasks use each) | `GET /api/labels` | everyone in the organization |
| Create | `POST /api/labels` `{ name, color? }` | members and above |
| Rename / recolor | `PATCH /api/labels/:id` `{ name?, color? }` | members and above |
| Delete (removes it from every task) | `DELETE /api/labels/:id` | admins and owners |
| Set a task's labels | `PUT /api/projects/:projectId/tasks/:taskId/labels` `{ label_ids }` | members and above |

- **Colors** come from a fixed palette: `gray` (default), `red`, `orange`, `yellow`, `green`,
  `teal`, `blue`, `indigo`, `purple`, `pink`. There is no free-form hex, so a label can never carry
  arbitrary CSS, and each color has a light and a dark rendering (`apps/frontend/src/lib/labels.ts`).
- **Limits:** 200 labels per organization, 20 per task.
- **Setting a task's labels** replaces the whole set. Every id must be a label of your organization,
  or nothing changes (400). Concurrent edits of the same task apply one after the other.
- **Tasks carry their labels** (`labels: [{ id, name, color }]`, sorted by name) on the board and in
  `GET /api/tasks`. Both accept `label=<id>` (repeat it for "any of these"); see `docs/pagination.md`.
- **Live updates:** changing a task's labels publishes `task_updated`. Creating, renaming, recoloring
  or deleting a label publishes `labels_changed`, so open boards reload their labels and tasks. Cached
  boards that show a changed label are dropped.
- **Audit:** `activity_log` records label `created`/`updated`/`deleted`, and `labels_changed` on the
  task with the added and removed ids.
