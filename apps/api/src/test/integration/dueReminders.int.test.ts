import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/**
 * The worker's due-date reminder sweep (apps/worker/src/processors/dueReminders.ts) against real
 * Postgres and the full schema. Loaded at run time: it lives in the worker package, outside this
 * package's TypeScript build.
 */
let SQL: string;
let WINDOW_HOURS: number;

beforeAll(async () => {
  const file = path.resolve(__dirname, '../../../../worker/src/processors/dueReminders.ts');
  const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
  SQL = mod.DUE_REMINDER_SQL;
  WINDOW_HOURS = mod.REMINDER_WINDOW_HOURS;
});

describe('due-date reminders (real Postgres)', () => {
  let app: App;
  let owner: Actor;
  let member: Actor;
  let projectId: string;

  beforeEach(async () => {
    app = await startApp();
    owner = await registerOrg(app);
    member = await addUser(app, owner.orgId, 'member');
    projectId = (await createProject(app, owner)).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const sweep = () => db.query<{ org_id: string; user_id: string }>(SQL, [WINDOW_HOURS]);
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const task = (extra: Record<string, unknown>) => createTask(app, owner, projectId, { assignee_id: member.userId, ...extra });
  const reminders = (taskId: string) =>
    db.query<{ user_id: string; actor_id: string | null; data: { title: string } }>(
      "SELECT user_id, actor_id, data FROM notifications WHERE task_id = $1 AND type = 'due_soon'",
      [taskId]
    );

  it('reminds the assignee once when a task is due within 24 hours', async () => {
    const soon = await task({ title: 'Ship it', due_date: inHours(3) });

    const sent = await sweep();
    expect(sent.filter((r) => r.user_id === member.userId)).toHaveLength(1);
    expect(await reminders(soon.id)).toEqual([{ user_id: member.userId, actor_id: null, data: expect.objectContaining({ title: 'Ship it' }) }]);

    // The next sweep finds nothing new.
    await sweep();
    expect(await reminders(soon.id)).toHaveLength(1);
  });

  it('reminds again when the due date moves, and never for done, later, past or unassigned tasks', async () => {
    const moved = await task({ due_date: inHours(2) });
    await sweep();
    await db.query("UPDATE tasks SET due_date = NOW() + interval '5 hours' WHERE id = $1", [moved.id]);
    await sweep();
    expect(await reminders(moved.id)).toHaveLength(2);

    const done = await task({ due_date: inHours(2) });
    await db.query("UPDATE tasks SET status = 'done' WHERE id = $1", [done.id]);
    const later = await task({ due_date: inHours(48) });
    const past = await task({ due_date: inHours(-2) });
    const unassigned = await createTask(app, owner, projectId, { due_date: inHours(2) });
    await sweep();
    for (const t of [done, later, past, unassigned]) expect(await reminders(t.id)).toHaveLength(0);
  });

  it('skips removed members and people who can no longer see a private project', async () => {
    const removedTask = await task({ due_date: inHours(2) });
    await db.query('UPDATE users SET deactivated_at = NOW() WHERE id = $1', [member.userId]);

    const other = await addUser(app, owner.orgId, 'member');
    const hidden = await createTask(app, owner, projectId, { assignee_id: other.userId, due_date: inHours(2) });
    await db.query("UPDATE projects SET visibility = 'private' WHERE id = $1", [projectId]);

    await sweep();
    expect(await reminders(removedTask.id)).toHaveLength(0);
    expect(await reminders(hidden.id)).toHaveLength(0);
    // Not claimed either, so it is reminded if access comes back before the due date.
    expect(await row('SELECT due_reminder_sent_for FROM tasks WHERE id = $1', [hidden.id])).toEqual({ due_reminder_sent_for: null });
  });

  it('notifies once even when two sweeps run at the same time', async () => {
    const soon = await task({ due_date: inHours(1) });
    await Promise.all([sweep(), sweep(), sweep()]);
    expect(await reminders(soon.id)).toHaveLength(1);
  });
});
