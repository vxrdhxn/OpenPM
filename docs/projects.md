# Projects and who can see them

A project holds a board of tasks. Every project has a **visibility**:

| Visibility | Who can see it |
| --- | --- |
| `workspace` (the default) | Everyone in the organization. |
| `private` | The people added to it, plus the organization's admins and owners. |

**Seeing a project means seeing everything in it**: the board, tasks, comments, attachments, its
activity, live updates and notifications about it. What someone may do inside a project still
comes from their organization role (viewers read, members edit, admins delete), as before.

To anyone who cannot see a private project, it does not exist: every request for it answers
`404 Project not found`, exactly as for a project of another organization.

## API

| Action | Route | Who |
| --- | --- | --- |
| Create (optionally private) | `POST /api/projects` `{ name, description?, visibility? }` | member and up |
| Change visibility | `PATCH /api/projects/:id` `{ visibility }` | admins, owners and the project's creator |
| People who can see it | `GET /api/projects/:projectId/members` | anyone who can see it |
| Add someone | `POST /api/projects/:projectId/members` `{ user_id }` | member and up who can see it |
| Remove someone | `DELETE /api/projects/:projectId/members/:userId` | member and up; anyone may remove themselves |

`GET .../members` lists everyone who can see the project (the choices for assignee and
@mentions), with `member: true` for people added explicitly; admins and owners are listed with
`member: false` unless added. Membership is kept when a project goes back to `workspace`, so making
it private again restores the same people. Adding and removing people, and visibility changes, are
recorded in `activity_log` (`member_added`, `member_removed`, `updated`).

Rules that keep it consistent:

- **The creator is always added**, so a private project stays visible to them even if they are
  later demoted from admin.
- **Whoever makes a project private is added**, so they cannot lock themselves out.
- **An assignee can always open their task.** Tasks can only be assigned to, and people only
  @mentioned by, someone who can see the project. Making a project private, or removing someone from
  it, unassigns tasks held by people who can no longer see it.
- **Notifications follow visibility**: nobody is notified about a project they cannot see, and
  someone removed from a project stops seeing its earlier notifications.
- **Removing someone from the organization** also removes them from every project.
- Only admins, owners and the project's creator can change an existing project's visibility, so a
  member cannot hide a shared project from the rest of the team.

## How it is enforced

- **One gate for everything inside a project.** A hook in `app.ts` runs before every route under
  `/api/projects/:projectId/...` and `/api/projects/:id`, and answers 404 if the caller cannot see
  that project: tasks, comments, attachments, task labels and members alike. A test
  (`routes/projectGate.test.ts`) fails if a route under `/api/projects/` names its project
  parameter any other way, which would let it skip the gate.
- **Organization-wide reads filter by the same rule** (`security/projectAccess.ts`): the project
  list, task search, the dashboard, the activity feed, notifications and label task counts. The
  activity feed shows an entry only if its project still exists and is visible, so the titles of
  deleted tasks in a private project stay hidden; for members (not admins), entries about
  deleted projects are hidden too.
- **The project list is cached only for admins and owners**, who all see the same list; everyone
  else's list comes from Postgres, filtered for them.
- **Live events** (`routes/websocket.ts`): each connection keeps the set of private projects its
  user cannot see and drops events about them. The set is loaded before any project event is sent,
  reloaded when access changes (`project_access_changed`, sent with only the project id) and at
  every heartbeat (which also picks up role changes). Events about a project that was made private
  at the very moment of another change can reach a client that is about to lose access, in the
  milliseconds before its reload.

## Rolling back

Releases before private projects ignore `visibility`: rolling back to one makes every private
project visible to the whole workspace until you upgrade again. Keep that in mind before a rollback
(docs/releasing.md).
