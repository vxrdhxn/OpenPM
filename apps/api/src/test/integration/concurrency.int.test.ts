import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/** Optimistic concurrency on task edits (docs/concurrency.md), against real Postgres. */
describe('task versions (real Postgres)', () => {
  let app: App;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const patch = (actor: Actor, projectId: string, taskId: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, headers: actor.auth, payload });

  it('starts at 1 and bumps the version on every update', async () => {
    const owner = await registerOrg(app);
    const project = await createProject(app, owner);
    const task = await createTask(app, owner, project.id);
    expect((task as { version?: number }).version).toBe(1);

    const first = await patch(owner, project.id, task.id, { priority: 'high', version: 1 });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(2);
    // Without a version, an update applies to whatever is current (and still bumps it).
    expect((await patch(owner, project.id, task.id, { priority: 'low' })).json().version).toBe(3);
  });

  it('refuses an edit based on an old version, answers with the current task, and changes nothing', async () => {
    const owner = await registerOrg(app);
    const member = await addUser(app, owner.orgId, 'member');
    const project = await createProject(app, owner);
    const task = await createTask(app, owner, project.id);

    // Both open version 1; the member saves first.
    expect((await patch(member, project.id, task.id, { priority: 'urgent', version: 1 })).statusCode).toBe(200);

    const stale = await patch(owner, project.id, task.id, { priority: 'low', description: 'mine', version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: expect.stringMatching(/someone else changed/i), task: { id: task.id, priority: 'urgent', version: 2 } });

    const stored = await row<{ priority: string; description: string | null; version: number }>(
      'SELECT priority, description, version FROM tasks WHERE id = $1',
      [task.id]
    );
    expect(stored).toEqual({ priority: 'urgent', description: null, version: 2 });

    // Rebased on the current version, the same edit goes through.
    expect((await patch(owner, project.id, task.id, { description: 'mine', version: 2 })).statusCode).toBe(200);
  });

  it('lets exactly one of two concurrent edits of the same version through', async () => {
    const owner = await registerOrg(app);
    const project = await createProject(app, owner);
    const task = await createTask(app, owner, project.id);

    const results = await Promise.all([
      patch(owner, project.id, task.id, { title: 'A', version: 1 }),
      patch(owner, project.id, task.id, { title: 'B', version: 1 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await row<{ version: number }>('SELECT version FROM tasks WHERE id = $1', [task.id]))!.version).toBe(2);
  });

  it('does not leak another organization’s task in a conflict', async () => {
    const owner = await registerOrg(app);
    const project = await createProject(app, owner);
    const task = await createTask(app, owner, project.id);
    const outsider = await registerOrg(app);

    const res = await patch(outsider, project.id, task.id, { title: 'x', version: 99 });
    expect(res.statusCode).toBe(404);
    expect(Object.keys(res.json())).toEqual(['error']); // a 404, never the task
  });
});
