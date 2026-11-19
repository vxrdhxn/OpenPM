# Organizations and members

Each user belongs to exactly one organization (`users.org_id`). The API's `/api/members` routes
manage who is in it and `/api/organization` the workspace itself. Every query is scoped to the
organization in the caller's session; no organization id appears in a URL.

## Roles

`owner` > `admin` > `member` > `viewer`. Every request reads the role from the database (see
`plugins/auth.ts`), so a role change takes effect on the user's next request without a new login.

| Action | Route | Who |
|---|---|---|
| List members | `GET /api/members` | everyone in the organization |
| Change a role | `PATCH /api/members/:id` `{ role }` | admin or owner |
| Remove a member | `DELETE /api/members/:id` | admin or owner |
| Leave | `POST /api/members/leave` | anyone |
| Transfer ownership | `POST /api/members/:id/transfer-ownership` | owner |

Changing a role or removing someone is allowed only when all of these hold
(`security/memberPolicy.ts`):

- **Not yourself.** Use Leave instead, so nobody demotes or removes themselves by accident.
- **You outrank them.** An admin manages members and viewers, not other admins. Owners can also
  manage other owners.
- **Not above your own role.** An admin can make someone an admin, but not an owner.

**Every organization keeps an owner.** The person who signs up owns the workspace. The last owner
cannot leave, be removed or be demoted (409): they transfer ownership first. Organizations created
before owners existed (v0.1.0 and earlier) got one in migration 020: the longest-standing active
admin. The older rule, at least one admin or owner, still applies. Changes lock the organization
row, so two owners leaving at the same moment cannot both succeed.

**Transferring ownership** makes the chosen member the owner and the current owner an admin, in one
step. To have several owners instead, an owner can give someone the owner role.

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
`removed`, `left`, `ownership_transferred`).

## The workspace

| Action | Route | Who |
|---|---|---|
| Read name and slug | `GET /api/organization` | everyone in the organization |
| Rename | `PATCH /api/organization` `{ name }` | admin or owner |
| Delete | `DELETE /api/organization` `{ confirm_slug, password }` | owner |

The slug is chosen at sign-up and does not change. A rename is recorded in `activity_log`
(`entity_type = 'organization'`, action `renamed`).

**Deleting a workspace** needs the slug typed out and the owner's password, so neither a stray click
nor a stolen session alone can do it. It deletes everything in one transaction: members, projects,
tasks, comments, labels, notifications, invites and activity (every table references the
organization with `ON DELETE CASCADE`). Attachment files are deleted from storage after the commit,
like project deletion; a storage failure leaves logged orphaned files, never records pointing at
missing files. Every member's session fails at once (their accounts are gone), open WebSockets close
at the next heartbeat, and the email addresses can sign up again. Queued emails for the workspace are
skipped by the worker. There is no undo, except restoring a backup (`docs/backup-restore.md`).

## Invitations

Admins invite by email with a role (`POST /api/invites`); the link is valid for 7 days, and
inviting the same address again replaces it. The invitee can accept it, which creates their account,
or **decline** it (`POST /api/invites/decline`): the link stops working and the invite stays in the
admins' list, marked declined. Inviting them again sends a new link and clears the mark.

An organization holds at most **500 invites** at a time, pending, expired and declined together (all
of them are listed). Past that, a new invite is refused with 409 until old ones are revoked;
re-sending an existing invite is always allowed.

## Not implemented yet

Reactivating a removed member (invite them again instead).

Belonging to more than one organization is out of scope by decision (November 2026): each account
belongs to exactly one organization (`users.org_id`).
