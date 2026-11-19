# Privacy: what OpenPM stores, for how long, and how it is deleted

The organization running OpenPM is responsible for the data in it (it is the *controller*). This
page says exactly what the software keeps, so that organization can describe it to its users and
answer their requests.

## What is stored

### In the database

| What | Personal data in it | Kept |
| --- | --- | --- |
| **Accounts** (`users`) | name, email, role, a bcrypt password hash, notification preferences | until the person is removed (then anonymized, below) or the workspace is deleted |
| **Workspace content**: projects, tasks, comments, labels, attachment metadata | whatever people write; who created or was assigned what; @mentions | until deleted in the app, or with the workspace |
| **Activity feed** (`activity_log`) | who did what, with names of tasks and projects; never comment text | until the workspace is deleted |
| **Security audit log** (`audit_log`) | who, the IP address and browser (user agent) of sign-ins, failures, password changes and permission changes | **365 days** (`AUDIT_RETENTION_DAYS`) |
| **Notifications** | who caused what for whom; task title or a short comment excerpt | **90 days** (`NOTIFICATION_RETENTION_DAYS`), or until the task is deleted |
| **Invites** | the invited email address and role | until accepted, revoked or the workspace is deleted. The link expires after 7 days. At most 500 per workspace |
| **Pending sign-ups** (`signup_requests`) | email, name, workspace name, password hash | **24 hours**, or until used. Deleted when the next sign-up is made |
| **Password-reset links** | a hash of the token | **1 hour**, or until used |

Tokens (session, invite, reset, sign-up) are never stored in plain text: only their SHA-256 hash, or
for sessions only a version number.

### Elsewhere

| Where | What | Kept |
| --- | --- | --- |
| **Object storage** | the attached files themselves | as long as their task (`docs/attachments.md`) |
| **Redis** | a cached copy of boards (60 s) and project lists (5 min); queued jobs, which carry ids and the raw tokens to email | cache entries expire; jobs are removed when done (failed ones within 1 hour to 7 days, `docs/jobs.md`) |
| **Logs** (your log platform) | request ids, user and workspace ids, IP addresses, routes, the **domain** of email recipients. Never passwords, tokens, message bodies or full email addresses | **30 days** (`docs/observability.md`) |
| **Backups** | a full copy of the database | the newest 7 dumps with the in-chart Postgres; your provider's retention otherwise (`docs/backup-restore.md`) |
| **The email provider** (Resend, if configured) | recipient address, subject and body of invites, password resets, sign-up links and assignment emails | the provider's retention; review its terms |

## What is deliberately not collected

- No tracking, analytics or third-party scripts in the web app, and no cookies but the session.
- IP addresses go only to the security audit log and the logs, never to product data.
- Failed sign-ins for unknown addresses record nothing about the address.
- Email addresses never go into logs or metrics, only their domain.
- The worker only emails what the person needs (a link, a name, a task title).

## Retention periods

Every period above that runs out deletes the data automatically. The audit log, notifications,
pending sign-ups and links are swept by the API and the worker; logs and backups by their own
systems. The rest is kept while the workspace uses it, because a project tool needs its history.
That is the organization's decision to change by deleting content or the workspace.

## Deleting a person: account deletion

There is one account per person and workspace. **Removing a member** (an admin, Settings →
Members) or **leaving** the workspace anonymizes the account (`docs/members.md`):

- the email address is replaced (`removed-<id>@removed.invalid`), and the password hash cleared;
- every session ends at once; outstanding reset links are deleted; their tasks are unassigned;
- they can no longer be found, assigned, mentioned or notified.

**Kept:** their **name** on what they did (tasks they created, their comments, the activity feed),
so the workspace's history still makes sense. The security audit log keeps their entries (and IP
addresses) for its 365 days. If someone has a right to have their name removed too, an operator can
rename the deactivated account in the database:

```sql
UPDATE users SET name = 'Former member' WHERE id = '<user id>' AND deactivated_at IS NOT NULL;
```

Content a person wrote (comments, task descriptions) belongs to the workspace and stays unless it is
deleted in the app. Deleting it is the workspace's call.

## Deleting a workspace

The owner can delete the whole workspace (Settings → Organization; the slug typed out and their
password). This deletes, in one transaction, every account, project, task, comment, label, invite,
notification, the activity feed and the audit log, then the attachment files
(`docs/data-deletion.md`). Copies remain only in backups until they age out, and in logs for their
30 days.

## Export

There is no self-service export yet. Everything a person can see is available through the API
(`docs/api.md`, `docs/openapi.json`), and an operator can export one workspace from the database:
every table has an `org_id`. A per-user export (*download my data*) is a known gap.

## Requests from people

| Request | How |
| --- | --- |
| *What do you have about me?* | This page; an operator can query the tables above by user id. |
| *Correct it* | They change their own name and password (Settings → Profile); an admin changes roles. |
| *Delete me* | Remove them from the workspace (above), and rename them if needed. |
| *A copy of my data* | An operator exports it (above). |
