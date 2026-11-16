import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { published } from './fakes';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/**
 * Org B (an admin, the most privileged role there) attacks org A's resources by id. Every attempt must
 * fail as if the resource did not exist, and the database must be unchanged afterwards.
 */
describe('tenant isolation (real Postgres)', () => {
  let app: App;
  let a: Actor;
  let b: Actor;
  let projectA: { id: string };
  let taskA: { id: string };
  let projectB: { id: string };
  let taskB: { id: string };

  beforeAll(async () => {
    app = await startApp();
    a = await registerOrg(app);
    b = await registerOrg(app);
    projectA = await createProject(app, a, 'Secret project A');
    taskA = await createTask(app, a, projectA.id, { title: 'Secret task A' });
    projectB = await createProject(app, b);
    taskB = await createTask(app, b, projectB.id);
  });

  afterAll(async () => {
    await app.close();
  });

  const asB = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: b.auth, payload });

  describe('projects', () => {
    it('lists only the caller organization', async () => {
      const res = await asB('GET', '/api/projects');

      expect(res.statusCode).toBe(200);
      const ids = res.json().items.map((p: { id: string }) => p.id);
      expect(ids).toContain(projectB.id);
      expect(ids).not.toContain(projectA.id);
    });

    it('cannot read another org project by id', async () => {
      expect((await asB('GET', `/api/projects/${projectA.id}`)).statusCode).toBe(404);
    });

    it('cannot modify another org project, and the row is unchanged', async () => {
      const res = await asB('PATCH', `/api/projects/${projectA.id}`, { name: 'pwned', status: 'archived' });

      expect(res.statusCode).toBe(404);
      expect(await row('SELECT name, status FROM projects WHERE id = $1', [projectA.id])).toEqual({
        name: 'Secret project A',
        status: 'active',
      });
    });

    it('cannot delete another org project, and it still exists with its tasks', async () => {
      expect((await asB('DELETE', `/api/projects/${projectA.id}`)).statusCode).toBe(404);
      expect(await row('SELECT id FROM projects WHERE id = $1', [projectA.id])).toBeDefined();
      expect(await row('SELECT id FROM tasks WHERE id = $1', [taskA.id])).toBeDefined();
    });

    it('cannot create a project in another org by naming it', async () => {
      const res = await asB('POST', '/api/projects', { name: 'x', org_id: a.orgId });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('tasks', () => {
    it('cannot list another org board', async () => {
      expect((await asB('GET', `/api/projects/${projectA.id}/tasks`)).statusCode).toBe(404);
    });

    it('cannot create a task in another org project', async () => {
      const res = await asB('POST', `/api/projects/${projectA.id}/tasks`, { title: 'planted' });

      expect(res.statusCode).toBe(404);
      expect(await row("SELECT id FROM tasks WHERE title = 'planted'", [])).toBeUndefined();
    });

    it('cannot modify another org task, through either project id', async () => {
      for (const projectId of [projectA.id, projectB.id]) {
        const res = await asB('PATCH', `/api/projects/${projectId}/tasks/${taskA.id}`, { title: 'pwned', status: 'done' });
        expect(res.statusCode).toBe(404);
      }
      expect(await row('SELECT title, status FROM tasks WHERE id = $1', [taskA.id])).toEqual({
        title: 'Secret task A',
        status: 'todo',
      });
    });

    it('cannot delete another org task, through either project id', async () => {
      for (const projectId of [projectA.id, projectB.id]) {
        expect((await asB('DELETE', `/api/projects/${projectId}/tasks/${taskA.id}`)).statusCode).toBe(404);
      }
      expect(await row('SELECT id FROM tasks WHERE id = $1', [taskA.id])).toBeDefined();
    });

    it('cannot assign its task to a user of another org (no cross-org names leak onto the board)', async () => {
      const patch = await asB('PATCH', `/api/projects/${projectB.id}/tasks/${taskB.id}`, { assignee_id: a.userId });
      const create = await asB('POST', `/api/projects/${projectB.id}/tasks`, { title: 'assigned out', assignee_id: a.userId });

      expect(patch.statusCode).toBe(400);
      expect(create.statusCode).toBe(400);
      expect(await row('SELECT assignee_id FROM tasks WHERE id = $1', [taskB.id])).toEqual({ assignee_id: null });
    });

    it('can assign its task to a user of its own org', async () => {
      const colleague = await addUser(app, b.orgId, 'member');

      const res = await asB('PATCH', `/api/projects/${projectB.id}/tasks/${taskB.id}`, { assignee_id: colleague.userId });

      expect(res.statusCode).toBe(200);
      expect(res.json().assignee_id).toBe(colleague.userId);
    });

    it('publishes realtime events only on the acting org channel', async () => {
      const before = published.length;
      await createTask(app, b, projectB.id);

      const events = published.slice(before);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(e.channel).toBe(`org:${b.orgId}:updates`);
    });
  });

  describe('invites', () => {
    it('cannot see or revoke another org invites', async () => {
      const created = await app.inject({ method: 'POST', url: '/api/invites', headers: a.auth, payload: { email: `x-${Date.now()}@example.com` } });
      expect(created.statusCode).toBe(201);
      const inviteA = created.json();

      const list = await asB('GET', '/api/invites');
      expect(list.json().map((i: { id: string }) => i.id)).not.toContain(inviteA.id);

      expect((await asB('DELETE', `/api/invites/${inviteA.id}`)).statusCode).toBe(404);
      expect(await row('SELECT id FROM organization_invites WHERE id = $1', [inviteA.id])).toBeDefined();
    });
  });

  describe('activity log', () => {
    it('records each action under the org that performed it', async () => {
      const entries = await row<{ orgs: string[] }>(
        'SELECT array_agg(DISTINCT org_id::text) AS orgs FROM activity_log WHERE entity_id = ANY($1::uuid[])',
        [[projectA.id, taskA.id]]
      );
      expect(entries!.orgs).toEqual([a.orgId]);
    });
  });
});

describe('roles (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let project: { id: string };
  let task: { id: string };

  beforeAll(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    project = await createProject(app, admin);
    task = await createTask(app, admin, project.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a viewer can read but not write', async () => {
    const viewer = await addUser(app, admin.orgId, 'viewer');

    expect((await app.inject({ method: 'GET', url: `/api/projects/${project.id}/tasks`, headers: viewer.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/projects', headers: viewer.auth, payload: { name: 'x' } })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, headers: viewer.auth, payload: { status: 'done' } })).statusCode
    ).toBe(403);
  });

  it('a member can edit but not delete, and cannot invite', async () => {
    const member = await addUser(app, admin.orgId, 'member');

    expect(
      (await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/tasks/${task.id}`, headers: member.auth, payload: { status: 'done' } })).statusCode
    ).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/tasks/${task.id}`, headers: member.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}`, headers: member.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/invites', headers: member.auth, payload: { email: 'y@example.com' } })).statusCode).toBe(403);
    expect(await row('SELECT id FROM tasks WHERE id = $1', [task.id])).toBeDefined();
  });

  it('a user cannot raise their own role through the profile', async () => {
    const member = await addUser(app, admin.orgId, 'member');

    const res = await app.inject({ method: 'PATCH', url: '/api/profile/me', headers: member.auth, payload: { role: 'owner' } });

    expect(res.statusCode).toBe(400);
    expect(await row('SELECT role FROM users WHERE id = $1', [member.userId])).toEqual({ role: 'member' });
  });

  it('rejects requests without a valid token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: 'Bearer not.a.jwt' } })).statusCode).toBe(401);
  });
});
