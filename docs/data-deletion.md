# What a delete removes

Every foreign key's `ON DELETE` rule is deliberate and pinned by a test
(`apps/api/src/test/integration/deletion.int.test.ts`): a new migration has to pick a rule and add it
to that test's table.

## The rules

| When this is deleted | These go with it (`CASCADE`) | These are kept |
| --- | --- | --- |
| **Organization** | everything in it: members, projects, tasks, comments, labels, attachments, invites, notifications, the activity feed and the security audit log | nothing |
| **Project** | its tasks (and everything under them), its member list, notifications about it | activity entries, which keep the project's name |
| **Task** | its comments, attachments, label assignments, notifications about it | activity entries, which keep the task's title |
| **Comment** | its mentions and notifications | activity entries (without the text) |
| **Label** | its assignments to tasks | the tasks |

Attachment *files* are not rows: the API deletes them from object storage after the database
transaction commits (`docs/attachments.md`). A storage failure leaves a logged orphan file, never a
record pointing at a missing file.

## Users are deactivated, not deleted

Removing a member or leaving a workspace sets `users.deactivated_at` (`docs/members.md`). Nothing in
the application deletes a user row except deleting the whole organization. The schema backs this up:

- **Refused (`NO ACTION`):** columns that record who did something: `projects.created_by`,
  `tasks.created_by`, `task_comments.author_id`, `task_attachments.uploaded_by` and
  `activity_log.user_id` (CASCADE until migration 023). Deleting a user with any history fails
  instead of erasing it. Deleting an organization still works, because its users and their history
  go in the same statement.
- **Cleared (`SET NULL`):** where the person is incidental: a task's assignee, a notification's actor,
  the audit log's actor, who added someone to a project.
- **Deleted with the user (`CASCADE`):** rows that only exist for them: their notifications, mentions,
  project memberships and password-reset links.

## Not covered here

Retention (how long rows are kept before deletion) is separate: the audit log is pruned after
`AUDIT_RETENTION_DAYS` (`docs/audit-log.md`); notifications are kept until their task is deleted.
