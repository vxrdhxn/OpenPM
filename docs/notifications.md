# Notifications

In-app notifications tell people when something needs them. They are created on the server, in the
same transaction as the change that causes them, so a rolled-back change never notifies anyone.

## When you are notified

| Type | When | Who |
|---|---|---|
| `task_assigned` | a task is created with you as assignee, or reassigned to you | the new assignee |
| `mentioned` | someone @mentions you in a comment (or adds you when editing one) | each newly mentioned person |
| `commented` | someone comments on a task | the task's assignee and creator, unless they were mentioned in that comment |
| `status_changed` | a task moves to another column | the task's assignee and creator, except someone who was just assigned it in the same change |
| `due_soon` | an open task is due within the next 24 hours | the task's assignee (no actor: it comes from the server) |

Never for your own actions, never to removed members, and never across organizations: recipients are
filtered in the `INSERT ... SELECT` itself (`apps/api/src/notifications/notify.ts`).

## Mentions

The comment box suggests organization members after `@`. Picking one inserts `@Name` and sends the
member's id in `mention_ids` with the comment (only people whose `@Name` is still in the text when it
is sent). The API checks that every id is an active member of the organization (400 otherwise) and
records the mentions in `comment_mentions`, so editing a comment only notifies people who are newly
mentioned. A comment's `mentions` field lists who it mentions.

## API (always only the caller's own)

| Route | |
|---|---|
| `GET /api/notifications` | newest first, paginated (`limit`, `cursor`); `?unread=true` for unread only |
| `GET /api/notifications/unread-count` | `{ count }`, for the badge |
| `POST /api/notifications/:id/read` | mark one read (idempotent); 404 for anyone else's |
| `POST /api/notifications/read-all` | mark all read; returns `{ marked }` |

Each item has `type`, `actor_name`, `task_title` (current title), `project_id`, `task_id`,
`comment_id`, `data` (`title`, a 140-character `excerpt` for comments, `from`/`to` for status
changes), `read_at` and `created_at`. Notifications are deleted with their task.

## Live delivery

After the transaction commits, the API publishes `{ "type": "notification", "user_ids": [...] }` on
the organization's channel. The event carries **no content**: each client checks whether its own id
is listed and then fetches its notifications over HTTP, which only ever returns the caller's. The
sidebar badge also refreshes on focus, after a reconnect and once a minute, so a missed event costs a
minute at most.

The signed-in layout keeps **one** WebSocket for the whole app (`WebsocketProvider`); the badge, the
notifications page and the board all read from it.

## Due-date reminders

The worker runs a sweep every 15 minutes (`DUE_REMINDER_INTERVAL_MINUTES`; a BullMQ job scheduler, so
one schedule however many worker replicas there are). It notifies the assignee of every task that is
not done and is due within the next 24 hours, and sends the same live `notification` event as the API.

- **Once per due date.** `tasks.due_reminder_sent_for` (migration 025) records the due date that was
  reminded about. Moving the due date earns a new reminder; overlapping sweeps cannot both send one
  (the claim and the insert are one statement, under the row lock).
- **Same recipient rules** as every notification: active members who can see the project. A task
  whose assignee cannot see it is not claimed, so it is still reminded if access comes back in time.
- **Past due dates** are not reminded (a task created already overdue, or a sweep missed during an
  outage of more than a day).
- A failed sweep is not retried: the next one, minutes later, picks up the same tasks.

Code: `apps/worker/src/processors/dueReminders.ts`; tested against Postgres in
`apps/api/src/test/integration/dueReminders.int.test.ts`.

## Not implemented yet

- Per-user preferences (muting types, email digests).
- A retention policy: notifications are kept until their task is deleted.
