# Security audit log

A record of sign-ins, failed sign-ins, password changes, and changes to who can do or see what. It
is separate from the activity feed (`activity_log`), which every member reads and which shows work
on projects and tasks.

- **Who can read it:** admins and owners, in *Settings → Security log* or at `GET /api/audit`.
- **Who can change it:** nobody. No route writes, edits or deletes entries. The app's database user
  can add entries and delete old ones, but cannot `UPDATE` or `TRUNCATE` the table
  ([database-access.md](database-access.md)).
- **How long entries are kept:** `AUDIT_RETENTION_DAYS`, 365 by default. Every API pod deletes
  older entries every 6 hours, starting about a minute after it starts.

## What is recorded

| Action | When | Actor | Target |
| --- | --- | --- | --- |
| `auth.registered` | Someone creates a workspace (its first account) | them | the organization |
| `auth.login` | A sign-in succeeds | them | them |
| `auth.admin_login` | A sign-in through the **admin** sign-in succeeds (owners and admins only) | them | them |
| `auth.admin_login_denied` | The right password at the admin sign-in, for an account that is not an owner or admin: no session is issued | them | them |
| `auth.login_failed` | A wrong password for an **existing, active** account | none | the account |
| `auth.logout` | Sign-out (ends every session of that user) | them | them |
| `auth.password_changed` | From the profile page (needs the current password) | them | them |
| `auth.password_change_failed` | Wrong current password on the profile page | them | them |
| `auth.password_reset_requested` | *Forgot password* for an existing account | none | the account |
| `auth.password_reset` | A reset link is used | none | the account |
| `member.role_changed` | `{ from, to }` | admin/owner | the member |
| `member.removed`, `member.left` | | admin/owner, or them | the member |
| `member.ownership_transferred` | | the old owner | the new owner |
| `invite.created`, `invite.revoked` | `{ role }` | admin/owner | the invite |
| `invite.accepted` | `{ role }` | the new member | the invite |
| `invite.declined` | `{ email }` | none | the invite |
| `organization.renamed` | `{ from, to }` | admin/owner | the organization |
| `project.visibility_changed` | `{ from, to, unassigned }` | | the project |
| `project.member_added`, `project.member_removed` | `{ user_id, name }` | | the project |
| `project.deleted` | `{ name }` | admin/owner | the project |

Every entry also has the time, the client's IP address (`request.ip`: behind the Ingress this is the
real client, see `TRUST_PROXY` in [deploying.md](deploying.md)), the user agent (first 256
characters) and the request id, which matches the `X-Request-Id` header and the API's log line.

Never recorded: passwords, tokens or token hashes, and nothing about **email addresses that have no
account**. A failed sign-in for an unknown address belongs to no workspace, so it shows up only in
the API log and the `auth_failures_total` metric. Recording it would tell a workspace who tries to
sign in elsewhere. A failed sign-in is written without making the response wait, so it does not
make an existing account answer more slowly than an unknown one (account enumeration).

## How it is written

Changes that happen in a transaction (role changes, project access, invites, renames) write their
entry in the same transaction: the entry exists if and only if the change does. Sign-in, sign-out,
password changes and declined invites have nothing to roll back. If writing their entry fails, the
API logs `Could not write the audit log` with the action, and the request still succeeds, so a
problem with this table cannot stop people signing in.

**Deleting a workspace deletes its audit log** with everything else in it. The API log keeps one
line, `organization_deleted`, with the organization, the owner and their IP address.

## API

`GET /api/audit?limit=&cursor=&action=&user_id=`, admins and owners only. Newest first, paged like
every other list ([pagination.md](pagination.md)). `action` is one of the names above (anything else
is a 400). `user_id` returns entries by that person or about them.

```json
{ "items": [{ "id": "…", "action": "member.role_changed", "created_at": "…",
              "actor_id": "…", "actor_name": "Ada", "actor_email": "ada@example.com",
              "target_type": "user", "target_id": "…", "target_name": "Bo",
              "ip": "203.0.113.7", "user_agent": "Mozilla/5.0 …", "request_id": "…",
              "metadata": { "from": "member", "to": "admin" } }],
  "next_cursor": null }
```

Tests: `test/integration/auditLog.int.test.ts` (what is recorded and what is not, access, filters,
retention), `test/integration/databaseAccess.int.test.ts` (the app cannot edit entries).
