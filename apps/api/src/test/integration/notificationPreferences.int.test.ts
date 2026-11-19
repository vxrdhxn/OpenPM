import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/** Notification preferences and retention (docs/notifications.md), against real Postgres. */
const worker = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.resolve(__dirname, '../../../../worker/src/processors', file)).href);
let DUE_SQL: string;
let CLEANUP_SQL: string;

beforeAll(async () => {
  DUE_SQL = (await worker('dueReminders.ts')).DUE_REMINDER_SQL;
  CLEANUP_SQL = (await worker('notificationCleanup.ts')).CLEANUP_SQL;
});

describe('notification preferences (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let ada: Actor;
  let projectId: string;

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    ada = await addUser(app, admin.orgId, 'member');
    projectId = (await createProject(app, admin)).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers: actor.auth, payload });
  const mute = (actor: Actor, muted: string[]) => call(actor, 'PUT', '/api/notifications/preferences', { muted });
  const count = async (userId: string, type: string) =>
    (await db.query('SELECT 1 FROM notifications WHERE user_id = $1 AND type = $2', [userId, type])).length;

  it('starts with everything on, and saves only the caller’s own choice', async () => {
    const res = await call(ada, 'GET', '/api/notifications/preferences');
    expect(res.json()).toEqual({ types: ['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon'], muted: [] });

    expect((await mute(ada, ['commented', 'status_changed'])).statusCode).toBe(200);
    expect((await call(ada, 'GET', '/api/notifications/preferences')).json().muted).toEqual(['commented', 'status_changed']);
    expect((await call(admin, 'GET', '/api/notifications/preferences')).json().muted).toEqual([]);
  });

  it.each([[['nonsense']], [['commented', 'commented']], [[42]]])('refuses %j', async (muted) => {
    expect((await call(ada, 'PUT', '/api/notifications/preferences', { muted })).statusCode).toBe(400);
  });

  it('never writes a muted type, and still writes the others', async () => {
    await mute(ada, ['task_assigned']);
    const task = await createTask(app, admin, projectId, { assignee_id: ada.userId });
    expect(await count(ada.userId, 'task_assigned')).toBe(0);

    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${task.id}`, headers: admin.auth, payload: { status: 'done' } });
    expect(await count(ada.userId, 'status_changed')).toBe(1);
  });

  it('skips muted due-date reminders in the worker sweep', async () => {
    await mute(ada, ['due_soon']);
    const due = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const task = await createTask(app, admin, projectId, { assignee_id: ada.userId, due_date: due });

    await db.query(DUE_SQL, [24]);
    expect(await count(ada.userId, 'due_soon')).toBe(0);
    // Not claimed, so switching reminders back on before the due date still reminds.
    expect(await row('SELECT due_reminder_sent_for FROM tasks WHERE id = $1', [task.id])).toEqual({ due_reminder_sent_for: null });
    await mute(ada, []);
    await db.query(DUE_SQL, [24]);
    expect(await count(ada.userId, 'due_soon')).toBe(1);
  });
});

describe('notification retention (real Postgres)', () => {
  let app: App;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes notifications older than the retention period, read or not, and keeps newer ones', async () => {
    const admin = await registerOrg(app);
    const ada = await addUser(app, admin.orgId, 'member');
    const projectId = (await createProject(app, admin)).id;
    for (let i = 0; i < 3; i++) await createTask(app, admin, projectId, { assignee_id: ada.userId });
    const ids = (await db.query<{ id: string }>('SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at', [ada.userId])).map((r) => r.id);
    await db.query("UPDATE notifications SET created_at = NOW() - interval '91 days' WHERE id = $1", [ids[0]]);
    await db.query("UPDATE notifications SET created_at = NOW() - interval '91 days', read_at = NOW() WHERE id = $1", [ids[1]]);

    const res = await db.query(CLEANUP_SQL, [90, 5000]);
    void res;
    const left = (await db.query<{ id: string }>('SELECT id FROM notifications WHERE user_id = $1', [ada.userId])).map((r) => r.id);
    expect(left).toEqual([ids[2]]);
  });
});
