import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, createProject, createTask, registerOrg, startApp, type Actor, type App } from './harness';

/** Phase I: the dashboard summary and the activity feed, against real Postgres. */
describe('dashboard and activity (real Postgres)', () => {
  let app: App;
  let admin: Actor;

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (actor: Actor, url: string) => app.inject({ method: 'GET', url, headers: actor.auth });
  const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

  describe('summary', () => {
    it('counts my open, overdue and due-this-week tasks, and nobody else', async () => {
      const member = await addUser(app, admin.orgId, 'member');
      const project = await createProject(app, admin);
      const mine = { assignee_id: admin.userId };
      await createTask(app, admin, project.id, { ...mine, due_date: days(-2) }); // overdue
      await createTask(app, admin, project.id, { ...mine, due_date: days(3) }); // due soon
      await createTask(app, admin, project.id, { ...mine, due_date: days(20) }); // later
      await createTask(app, admin, project.id, mine); // no due date
      const done = await createTask(app, admin, project.id, { ...mine, due_date: days(-5) });
      await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/tasks/${done.id}`, headers: admin.auth, payload: { status: 'done' } });
      await createTask(app, admin, project.id, { assignee_id: member.userId, due_date: days(-1) }); // not mine

      const res = await get(admin, '/api/dashboard');

      expect(res.statusCode).toBe(200);
      expect(res.json().my).toEqual({ open: 4, overdue: 1, due_soon: 1 });
    });

    it('shows progress for active projects, most recently active first, scoped to the org', async () => {
      const quiet = await createProject(app, admin, 'Quiet');
      const busy = await createProject(app, admin, 'Busy');
      const archived = await createProject(app, admin, 'Archived');
      await app.inject({ method: 'PATCH', url: `/api/projects/${archived.id}`, headers: admin.auth, payload: { status: 'archived' } });
      const t1 = await createTask(app, admin, busy.id);
      await createTask(app, admin, busy.id);
      await app.inject({ method: 'PATCH', url: `/api/projects/${busy.id}/tasks/${t1.id}`, headers: admin.auth, payload: { status: 'done' } });

      const other = await registerOrg(app);
      await createProject(app, other, 'Not ours');

      const { projects } = (await get(admin, '/api/dashboard')).json();

      expect(projects.active).toBe(2);
      expect(projects.recent.map((p: { name: string }) => p.name)).toEqual(['Busy', 'Quiet']);
      expect(projects.recent[0]).toMatchObject({ id: busy.id, total: 2, done: 1, todo: 1, in_progress: 0, in_review: 0 });
      expect(projects.recent[1]).toMatchObject({ id: quiet.id, total: 0, done: 0 });
    });

    it('requires authentication', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
    });
  });

  describe('activity feed', () => {
    it('lists product activity newest first, with names, and no account events', async () => {
      const project = await createProject(app, admin, 'Launch');
      const task = await createTask(app, admin, project.id, { title: 'Write copy' });
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/tasks/${task.id}/comments`,
        headers: admin.auth,
        payload: { body: 'On it' },
      });
      // An account event that must not appear in the feed.
      await db.query(
        "INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action) VALUES ($1, $2, 'user', $2, 'password_reset')",
        [admin.orgId, admin.userId]
      );

      const { items } = (await get(admin, '/api/activity')).json();

      expect(items.map((a: { entity_type: string; action: string }) => `${a.entity_type}:${a.action}`)).toEqual([
        'comment:created',
        'task:created',
        'project:created',
      ]);
      expect(items[0]).toMatchObject({ entity_name: 'Write copy', task_id: task.id, project_id: project.id, user_name: expect.any(String) });
      expect(items[2]).toMatchObject({ entity_name: 'Launch', project_id: project.id });
      expect(items[0]).not.toHaveProperty('sort_key');
    });

    it('still names a deleted task and a deleted project', async () => {
      const project = await createProject(app, admin, 'Short-lived');
      const task = await createTask(app, admin, project.id, { title: 'Gone task' });
      await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/tasks/${task.id}`, headers: admin.auth });
      await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}`, headers: admin.auth });

      const { items } = (await get(admin, '/api/activity')).json();

      expect(items[0]).toMatchObject({ entity_type: 'project', action: 'deleted', entity_name: 'Short-lived' });
      expect(items[1]).toMatchObject({ entity_type: 'task', action: 'deleted', entity_name: 'Gone task' });
    });

    it('filters by project, paginates, and never shows another organization', async () => {
      const a = await createProject(app, admin, 'A');
      const b = await createProject(app, admin, 'B');
      for (let i = 0; i < 3; i++) await createTask(app, admin, a.id);
      await createTask(app, admin, b.id);

      const other = await registerOrg(app);
      await createProject(app, other, 'Theirs');

      const first = (await get(admin, `/api/activity?project_id=${a.id}&limit=2`)).json();
      expect(first.items).toHaveLength(2);
      const second = (await get(admin, `/api/activity?project_id=${a.id}&limit=2&cursor=${first.next_cursor}`)).json();
      const all = [...first.items, ...second.items];
      expect(all).toHaveLength(4); // project created + 3 tasks
      expect(all.every((x: { project_id: string }) => x.project_id === a.id)).toBe(true);

      const everything = (await get(admin, '/api/activity?limit=100')).json().items;
      expect(everything.map((x: { entity_name: string }) => x.entity_name)).not.toContain('Theirs');
    });

    it('rejects bad parameters', async () => {
      expect((await get(admin, '/api/activity?limit=500')).statusCode).toBe(400);
      expect((await get(admin, '/api/activity?project_id=nope')).statusCode).toBe(400);
    });
  });
});
