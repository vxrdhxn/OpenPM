import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, createTask, registerOrg, row, startApp, unique, type Actor, type App } from './harness';

/**
 * Private projects (docs/projects.md), against real Postgres: a private project is visible only to
 * its members and the organization's admins and owners, everywhere the project's content can show.
 *
 * Cast: owner (created the private project), admin (not a member), ana (member, added), carol
 * (member, not added), vic (viewer, added).
 */
describe('private projects (real Postgres)', () => {
  let app: App;
  let owner: Actor, admin: Actor, ana: Actor, carol: Actor, vic: Actor;
  let secret: { id: string };
  let open: { id: string };
  let secretTask: { id: string };

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: actor.auth, payload });
  const project = async (actor: Actor, visibility: 'workspace' | 'private', name = `P ${unique()}`) => {
    const res = await call(actor, 'POST', '/api/projects', { name, visibility });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; visibility: string };
  };

  beforeAll(async () => {
    app = await startApp();
    owner = await registerOrg(app);
    admin = await addUser(app, owner.orgId, 'admin');
    ana = await addUser(app, owner.orgId, 'member');
    carol = await addUser(app, owner.orgId, 'member');
    vic = await addUser(app, owner.orgId, 'viewer');

    secret = await project(owner, 'private', `Payroll ${unique()}`);
    open = await project(owner, 'workspace');
    for (const who of [ana, vic]) {
      expect((await call(owner, 'POST', `/api/projects/${secret.id}/members`, { user_id: who.userId })).statusCode).toBe(201);
    }
    secretTask = await createTask(app, ana, secret.id, { title: 'Salary review', assignee_id: ana.userId });
    await createTask(app, owner, open.id, { title: 'Launch plan' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('who sees it', () => {
    it('members, admins and owners see it; other members do not, not even by id', async () => {
      for (const who of [owner, admin, ana, vic]) {
        expect((await call(who, 'GET', `/api/projects/${secret.id}`)).statusCode).toBe(200);
      }
      const res = await call(carol, 'GET', `/api/projects/${secret.id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Project not found' });

      const listed = async (who: Actor) => (await call(who, 'GET', '/api/projects')).json().items.map((p: { id: string }) => p.id);
      expect(await listed(carol)).toEqual(expect.arrayContaining([open.id]));
      expect(await listed(carol)).not.toContain(secret.id);
      expect(await listed(ana)).toEqual(expect.arrayContaining([open.id, secret.id]));
      expect(await listed(admin)).toEqual(expect.arrayContaining([open.id, secret.id]));
    });

    it('answers 404 to an outsider on every route inside the project', async () => {
      const base = `/api/projects/${secret.id}`;
      const task = `${base}/tasks/${secretTask.id}`;
      const attempts: Array<[Parameters<typeof call>[1], string, object?]> = [
        ['GET', `${base}/tasks`],
        ['POST', `${base}/tasks`, { title: 'Sneaky' }],
        ['PATCH', task, { title: 'Renamed' }],
        ['DELETE', task],
        ['GET', `${task}/comments`],
        ['POST', `${task}/comments`, { body: 'Hello?' }],
        ['GET', `${task}/attachments`],
        ['PUT', `${task}/labels`, { label_ids: [] }],
        ['GET', `${base}/members`],
        ['POST', `${base}/members`, { user_id: carol.userId }],
        ['PATCH', base, { name: 'Mine now' }],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await call(carol, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
      expect(await row('SELECT title FROM tasks WHERE id = $1', [secretTask.id])).toEqual({ title: 'Salary review' });
    });

    it('keeps its tasks out of search, the dashboard, the activity feed and label counts', async () => {
      const titles = async (who: Actor) => (await call(who, 'GET', '/api/tasks?q=Salary')).json().items.map((t: { title: string }) => t.title);
      expect(await titles(carol)).toEqual([]);
      expect(await titles(ana)).toEqual(['Salary review']);

      const dashboard = (await call(carol, 'GET', '/api/dashboard')).json();
      expect(dashboard.projects.recent.map((p: { id: string }) => p.id)).not.toContain(secret.id);
      const adminDashboard = (await call(admin, 'GET', '/api/dashboard')).json();
      expect(adminDashboard.projects.active).toBe(dashboard.projects.active + 1);

      const feed = async (who: Actor) => JSON.stringify((await call(who, 'GET', '/api/activity?limit=100')).json());
      expect(await feed(carol)).not.toContain('Salary review');
      expect(await feed(carol)).not.toContain('Payroll');
      expect(await feed(ana)).toContain('Salary review');
      // Asking for the project's feed directly gives nothing either.
      expect((await call(carol, 'GET', `/api/activity?project_id=${secret.id}`)).json().items).toEqual([]);

      const label = await call(owner, 'POST', '/api/labels', { name: `L-${unique()}`, color: 'red' });
      await call(ana, 'PUT', `/api/projects/${secret.id}/tasks/${secretTask.id}/labels`, { label_ids: [label.json().id] });
      const count = async (who: Actor) =>
        (await call(who, 'GET', '/api/labels')).json().find((l: { id: string }) => l.id === label.json().id).task_count;
      expect(await count(carol)).toBe(0);
      expect(await count(ana)).toBe(1);
    });

    it('keeps titles of deleted tasks out of the feed for outsiders', async () => {
      const doomed = await createTask(app, ana, secret.id, { title: `Bonus pool ${unique()}` });
      expect((await call(owner, 'DELETE', `/api/projects/${secret.id}/tasks/${doomed.id}`)).statusCode).toBe(204);
      const feed = async (who: Actor) => JSON.stringify((await call(who, 'GET', '/api/activity?limit=100')).json());
      expect(await feed(carol)).not.toContain('Bonus pool');
      expect(await feed(ana)).toContain('Bonus pool');
    });
  });

  describe('assignments, mentions and notifications', () => {
    it('only assigns and mentions people who can see the project', async () => {
      const toCarol = await call(ana, 'PATCH', `/api/projects/${secret.id}/tasks/${secretTask.id}`, { assignee_id: carol.userId });
      expect(toCarol.statusCode).toBe(400);
      expect(toCarol.json().error).toMatch(/can see this project/);
      // Admins see every project, so they can be assigned.
      expect((await call(ana, 'PATCH', `/api/projects/${secret.id}/tasks/${secretTask.id}`, { assignee_id: admin.userId })).statusCode).toBe(200);

      const mention = await call(ana, 'POST', `/api/projects/${secret.id}/tasks/${secretTask.id}/comments`, { body: 'hi', mention_ids: [carol.userId] });
      expect(mention.statusCode).toBe(400);
      expect((await call(ana, 'POST', `/api/projects/${secret.id}/tasks/${secretTask.id}/comments`, { body: 'hi', mention_ids: [vic.userId] })).statusCode).toBe(201);
    });

    it('lists the people who can see it, marking who was added', async () => {
      const people = (await call(vic, 'GET', `/api/projects/${secret.id}/members`)).json() as Array<{ id: string; member: boolean }>;
      const byId = new Map(people.map((p) => [p.id, p.member]));
      expect(byId.get(ana.userId)).toBe(true);
      expect(byId.get(vic.userId)).toBe(true);
      expect(byId.get(owner.userId)).toBe(true); // the creator
      expect(byId.get(admin.userId)).toBe(false); // sees it through the role
      expect(byId.has(carol.userId)).toBe(false);
    });
  });

  describe('managing who is in it', () => {
    it('lets members add and remove people, viewers only leave, and only people of the organization', async () => {
      const p = await project(ana, 'private');
      expect((await call(vic, 'POST', `/api/projects/${p.id}/members`, { user_id: vic.userId })).statusCode).toBe(404); // vic cannot see it

      const outsider = await registerOrg(app);
      expect((await call(ana, 'POST', `/api/projects/${p.id}/members`, { user_id: outsider.userId })).statusCode).toBe(400);

      expect((await call(ana, 'POST', `/api/projects/${p.id}/members`, { user_id: vic.userId })).statusCode).toBe(201);
      expect((await call(ana, 'POST', `/api/projects/${p.id}/members`, { user_id: vic.userId })).statusCode).toBe(200); // already in
      expect((await call(vic, 'POST', `/api/projects/${p.id}/members`, { user_id: carol.userId })).statusCode).toBe(403);
      expect((await call(vic, 'DELETE', `/api/projects/${p.id}/members/${ana.userId}`)).statusCode).toBe(403);
      expect((await call(vic, 'DELETE', `/api/projects/${p.id}/members/${vic.userId}`)).statusCode).toBe(204); // leave
      expect((await call(vic, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(404);
      expect(await row("SELECT metadata->>'name' AS name FROM activity_log WHERE entity_id = $1 AND action = 'member_removed'", [p.id]))
        .toBeDefined();
    });

    it('removing someone unassigns their tasks there and hides its notifications from them', async () => {
      const p = await project(owner, 'private');
      await call(owner, 'POST', `/api/projects/${p.id}/members`, { user_id: carol.userId });
      const task = await createTask(app, owner, p.id, { title: `Audit ${unique()}`, assignee_id: carol.userId });
      const notes = async () => (await call(carol, 'GET', '/api/notifications')).json().items.filter((n: { project_id: string }) => n.project_id === p.id);
      expect((await notes()).map((n: { type: string }) => n.type).sort()).toEqual(['project_added', 'task_assigned']);

      expect((await call(owner, 'DELETE', `/api/projects/${p.id}/members/${carol.userId}`)).statusCode).toBe(204);

      expect(await row('SELECT assignee_id FROM tasks WHERE id = $1', [task.id])).toEqual({ assignee_id: null });
      expect(await notes()).toEqual([]);
      // What she is told instead is not tied to the project.
      expect((await call(carol, 'GET', '/api/notifications')).json().items.some((n: { type: string }) => n.type === 'project_removed')).toBe(true);
      expect((await call(carol, 'GET', '/api/notifications/unread-count')).json().count).toBe(
        Number((await row<{ n: string }>(
          `SELECT count(*) AS n FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
            WHERE n.user_id = $1 AND n.read_at IS NULL AND (n.project_id IS NULL OR p.visibility = 'workspace')`, [carol.userId]))!.n)
      );
    });

    it('making a project private: only admins, owners and its creator; the creator stays in; assignees without access are unassigned', async () => {
      const shared = await project(ana, 'workspace');
      const carolsTask = await createTask(app, ana, shared.id, { assignee_id: carol.userId });

      expect((await call(carol, 'PATCH', `/api/projects/${shared.id}`, { visibility: 'private' })).statusCode).toBe(403);

      const res = await call(ana, 'PATCH', `/api/projects/${shared.id}`, { visibility: 'private' });
      expect(res.statusCode).toBe(200);
      expect(res.json().visibility).toBe('private');
      expect((await call(ana, 'GET', `/api/projects/${shared.id}`)).statusCode).toBe(200);
      expect((await call(carol, 'GET', `/api/projects/${shared.id}`)).statusCode).toBe(404);
      expect(await row('SELECT assignee_id FROM tasks WHERE id = $1', [carolsTask.id])).toEqual({ assignee_id: null });

      // And back: everyone sees it again.
      expect((await call(ana, 'PATCH', `/api/projects/${shared.id}`, { visibility: 'workspace' })).statusCode).toBe(200);
      expect((await call(carol, 'GET', `/api/projects/${shared.id}`)).statusCode).toBe(200);
    });

    it('a member removed from the organization leaves its projects too', async () => {
      const temp = await addUser(app, owner.orgId, 'member');
      await call(owner, 'POST', `/api/projects/${secret.id}/members`, { user_id: temp.userId });
      expect((await call(owner, 'DELETE', `/api/members/${temp.userId}`)).statusCode).toBe(204);
      expect(await row('SELECT 1 AS x FROM project_members WHERE user_id = $1', [temp.userId])).toBeUndefined();
    });
  });

  it('a project is open to the whole workspace unless made private', async () => {
    const p = await call(carol, 'POST', '/api/projects', { name: 'Defaults' });
    expect(p.json().visibility).toBe('workspace');
    expect((await call(vic, 'GET', `/api/projects/${p.json().id}/tasks`)).statusCode).toBe(200);
  });
});
