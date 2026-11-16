# Organization members

Each user belongs to exactly one organization (`users.org_id`). The API's `/api/members` routes
manage who is in it. Every query is scoped to the organization in the caller's token.

## Roles

`owner` > `admin` > `member` > `viewer`. Every request reads the role from the database (see
`plugins/auth.ts`), so a role change takes effect on the user's next request without a new login.

| Action | Route | Who |
|---|---|---|
| List members | `GET /api/members` | everyone in the organization |
| Change a role | `PATCH /api/members/:id` `{ role }` | admin or owner |
| Remove a member | `DELETE /api/members/:id` | admin or owner |
| Leave | `POST /api/members/leave` | anyone |

Changing a role or removing someone is allowed only when all of these hold
(`security/memberPolicy.ts`):

- **Not yourself.** Use Leave instead, so nobody demotes or removes themselves by accident.
- **You outrank them.** An admin manages members and viewers, not other admins. Owners can also
  manage other owners.
- **Not above your own role.** An admin can make someone an admin, but not an owner.

**Every organization keeps at least one admin or owner.** The last one cannot leave (409). Changes
lock the organization row, so two admins leaving at the same moment cannot both succeed.

The frontend shows only the actions these rules allow (`apps/frontend/src/lib/members.ts`). That is
for convenience; the API enforces the rules.

## What removal does

Removing a member (or leaving) **deactivates** the account rather than deleting it. Projects, tasks
and attachments reference their creator, and the activity log must not lose who did what.

- `deactivated_at` is set. The user is gone from the member list and can no longer be assigned.
- Their email becomes `removed-<id>@removed.invalid`, so the address can be invited again.
- Their password hash is cleared and `token_version` is bumped: every session ends at once, and open
  WebSockets close at their next heartbeat.
- Outstanding password-reset links are deleted.
- Tasks assigned to them become unassigned.
- Their name stays, so history still shows it.

Each change is recorded in `activity_log` (`entity_type = 'user'`, actions `role_changed`,
`removed`, `left`).

## Not implemented yet

Transferring ownership, reactivating a removed member, and deleting an organization.
