# Lists: pagination, search and filters

## Paginated endpoints

`GET /api/projects` and `GET /api/tasks` return one page at a time:

```json
{ "items": [ ... ], "next_cursor": "WyIyMDI2LTExLTE2IDA5OjA1OjAzLjEyMzQ1NiswMCIsIjNmMWMu..." }
```

- `limit`: 1-100, default 50. Anything else is a 400.
- `cursor`: pass the previous page's `next_cursor` to get the next page. `null` means this was the
  last page. Treat cursors as opaque. A cursor is valid only with the same filters and sort it was
  issued for. A tampered or foreign cursor is a 400.

This is keyset pagination, not `OFFSET`. Rows created or deleted between requests never shift a page,
and page 100 costs the same as page 1. Every sort has the row id as a tiebreak, so equal values
(many tasks with the same priority, or projects created in the same microsecond) are never skipped or
repeated. The cursor carries the sort value as Postgres text, not a JS `Date`, which would drop the
microseconds.

## `GET /api/projects`

Newest first. `q` matches the name (case-insensitive; `%` and `_` are literal). `status` is `active`
or `archived`. Only the plain first page (no filters, default limit) is cached.

## `GET /api/tasks`: search across the organization

| Parameter | Values |
|---|---|
| `project_id` | a project id |
| `status` | `todo`, `in_progress`, `in_review`, `done` (repeat for several) |
| `priority` | `low`, `medium`, `high`, `urgent` (repeat for several) |
| `assignee` | `me`, `none` (unassigned) or a user id |
| `label` | a label id (repeat for "any of these", up to 10) |
| `due_after`, `due_before` | ISO 8601 date-times; `due_after` is inclusive, `due_before` exclusive. Tasks without a due date never match a range. |
| `q` | text in the title or description (max 100 characters) |
| `sort` | `created_at` (default), `updated_at`, `due_date`, `priority` (urgent highest) |
| `order` | `desc` (default) or `asc`. Tasks without a due date sort last either way. |

Example ("my open work, most urgent deadline first"):

```
GET /api/tasks?assignee=me&status=todo&status=in_progress&sort=due_date&order=asc&limit=20
```

Each item has `project_id` and `project_name`, plus the task's `title`, `status`, `priority`,
assignee, `due_date` and timestamps.

## The board: `GET /api/projects/:projectId/tasks`

It is still grouped by status (`{ todo, in_progress, in_review, done }`), because a board shows
everything at once. It takes the same filters as task search except `project_id`, `sort` and
`order`. It returns at most 1000 tasks; past that the response has `X-Truncated: true`, and narrowing
the filters or paging through `GET /api/tasks` is the way to see the rest. Only the unfiltered board
is cached.

## Rules for all list parameters

Unknown query parameters are rejected (400), so a typo never silently returns unfiltered data. Every
value becomes a bind parameter. Sort columns come from a fixed list, never from the request.

Not paginated yet: `GET /api/members` and `GET /api/invites` (bounded by organization size) and a
task's attachments.
