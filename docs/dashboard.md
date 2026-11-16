# Dashboard

`/dashboard` is where you land after signing in. Every section loads on its own, so one failing
request shows an error in that section only.

| Section | Source |
|---|---|
| My open tasks · Overdue · Due in 7 days · Active projects | `GET /api/dashboard` |
| Assigned to me (soonest deadline first) | `GET /api/tasks?assignee=me&status=todo&status=in_progress&status=in_review&sort=due_date&order=asc` |
| Upcoming deadlines (anyone's, next 14 days) | `GET /api/tasks?status=...&due_after=<now>&due_before=<now+14d>&sort=due_date&order=asc` |
| Recently updated | `GET /api/tasks?sort=updated_at&order=desc` |
| Project progress | `GET /api/dashboard` (`projects.recent`) |
| Activity | `GET /api/activity` |

## `GET /api/dashboard`

```json
{
  "my": { "open": 4, "overdue": 1, "due_soon": 1 },
  "projects": { "active": 7, "recent": [{ "id": "...", "name": "Launch", "total": 12, "todo": 3, "in_progress": 4, "in_review": 1, "done": 4 }] }
}
```

`my` counts the caller's tasks that are not done. *Overdue* means the due date has passed; *due soon*
means due within the next 7 days. Both use the database clock. `recent` holds the 6 active projects
with the latest task activity.

## `GET /api/activity`

The organization's product activity (projects, tasks, comments), newest first and paginated like the
other lists (`limit`, `cursor`). `project_id` narrows it to one project. Account and membership
events (password resets, role changes, removals) are not in this feed; they stay in `activity_log`
for auditing. Each entry has `user_name`, `entity_type`, `action`, `entity_name` (still filled in for
deleted tasks and projects, from what was logged at deletion), `task_id`, `project_id` and, for task
updates, `changes`.

## Visual design

The headline numbers are stat tiles. Project progress is a meter list: a name, a thin done/total bar
and its figure per row, with the status breakdown as text. Colors follow the dataviz palette: the
meter fill and its lighter same-ramp track come from `--meter-fill` / `--meter-track` (their own steps
in dark mode). The reserved critical red appears only as an icon next to the word "Overdue" or
"Needs attention", never on its own and never on a number. These colors passed the palette
validator against the app's card surfaces (white and slate-900).
