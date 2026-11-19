import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, createProject, registerOrg, row, startApp, type App } from './harness';

/**
 * What a delete takes with it (docs/data-deletion.md). Every foreign key's ON DELETE rule is pinned
 * here, so a new migration has to choose one on purpose and say so in this table.
 */
const POLICY: Record<string, 'CASCADE' | 'SET NULL' | 'NO ACTION'> = {
  // Everything belongs to an organization and goes with it.
  'activity_log.org_id': 'CASCADE',
  'audit_log.org_id': 'CASCADE',
  'labels.org_id': 'CASCADE',
  'notifications.org_id': 'CASCADE',
  'organization_invites.org_id': 'CASCADE',
  'project_members.org_id': 'CASCADE',
  'projects.org_id': 'CASCADE',
  'task_attachments.org_id': 'CASCADE',
  'task_comments.org_id': 'CASCADE',
  'task_labels.org_id': 'CASCADE',
  'tasks.org_id': 'CASCADE',
  'users.org_id': 'CASCADE',

  // Parts of a project or task go with it.
  'tasks.project_id': 'CASCADE',
  'project_members.project_id': 'CASCADE',
  'notifications.project_id': 'CASCADE',
  'task_attachments.task_id': 'CASCADE', // the files are deleted by the service (services/attachments.ts)
  'task_comments.task_id': 'CASCADE',
  'task_labels.task_id': 'CASCADE',
  'task_labels.label_id': 'CASCADE',
  'notifications.task_id': 'CASCADE',
  'notifications.comment_id': 'CASCADE',
  'comment_mentions.comment_id': 'CASCADE',

  // Users are deactivated, never deleted. Who did something is history: a user delete is refused.
  'activity_log.user_id': 'NO ACTION',
  'projects.created_by': 'NO ACTION',
  'tasks.created_by': 'NO ACTION',
  'task_attachments.uploaded_by': 'NO ACTION',
  'task_comments.author_id': 'NO ACTION',
  // ...except where the person is incidental to the row.
  'tasks.assignee_id': 'SET NULL',
  'notifications.actor_id': 'SET NULL',
  'audit_log.actor_id': 'SET NULL',
  'project_members.added_by': 'SET NULL',
  // Rows that exist only for that user.
  'notifications.user_id': 'CASCADE',
  'comment_mentions.user_id': 'CASCADE',
  'project_members.user_id': 'CASCADE',
  'password_reset_tokens.user_id': 'CASCADE',
};

const RULES: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

describe('deletion policy (real Postgres)', () => {
  let app: App;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('every foreign key has the ON DELETE rule the policy names', async () => {
    const keys = await db.query<{ table: string; column: string; rule: string }>(
      `SELECT c.conrelid::regclass::text AS table, a.attname AS column, c.confdeltype AS rule
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`
    );
    const actual = Object.fromEntries(keys.map((k) => [`${k.table}.${k.column}`, RULES[k.rule]]));
    expect(actual).toEqual(POLICY);
  });

  it('refuses to delete a user with history, so their activity cannot vanish', async () => {
    const owner = await registerOrg(app);
    const member = await addUser(app, owner.orgId, 'member');
    // Only activity refers to this member (no tasks, comments or uploads of theirs).
    const project = await createProject(app, owner);
    await db.query(
      `INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action) VALUES ($1, $2, 'project', $3, 'updated')`,
      [owner.orgId, member.userId, project.id]
    );

    await expect(db.query('DELETE FROM users WHERE id = $1', [member.userId])).rejects.toThrow(/foreign key/);
    expect(await row('SELECT 1 FROM activity_log WHERE user_id = $1', [member.userId])).toBeDefined();
  });
});
