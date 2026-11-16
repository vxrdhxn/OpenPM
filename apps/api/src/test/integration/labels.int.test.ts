import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { published } from './fakes';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/** Phase I: labels, task labels and the label filter, against real Postgres. */
describe('labels (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    member = await addUser(app, admin.orgId, 'member');
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: actor.auth, payload });
  const createLabel = async (actor: Actor, name: string, color?: string) => {
    const res = await call(actor, 'POST', '/api/labels', { name, ...(color && { color }) });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; color: string };
  };
  const setLabels = (actor: Actor, projectId: string, taskId: string, ids: string[]) =>
    call(actor, 'PUT', `/api/projects/${projectId}/tasks/${taskId}/labels`, { label_ids: ids });

  describe('managing labels', () => {
    it('lets members create and edit, lists them by name, and announces changes', async () => {
      await createLabel(member, 'frontend', 'blue');
      const bug = await createLabel(member, '  Bug  ', 'red');
      expect(bug).toMatchObject({ name: 'Bug', color: 'red' });
      expect(published.at(-1)!.message).toEqual({ type: 'labels_changed' });

      const renamed = await call(member, 'PATCH', `/api/labels/${bug.id}`, { name: 'Defect' });
      expect(renamed.json()).toMatchObject({ name: 'Defect', color: 'red' });

      const list = (await call(admin, 'GET', '/api/labels')).json();
      expect(list.map((l: { name: string }) => l.name)).toEqual(['Defect', 'frontend']);
      expect(list[0]).toMatchObject({ task_count: 0 });
    });

    it('rejects duplicate names ignoring case, bad colors and blank names', async () => {
      await createLabel(member, 'Bug');

      expect((await call(member, 'POST', '/api/labels', { name: 'bug' })).statusCode).toBe(409);
      expect((await call(member, 'POST', '/api/labels', { name: 'x', color: '#ff0000' })).statusCode).toBe(400);
      expect((await call(member, 'POST', '/api/labels', { name: '   ' })).statusCode).toBe(400);
      expect((await call(member, 'POST', '/api/labels', { name: 'y'.repeat(51) })).statusCode).toBe(400);

      const other = await createLabel(member, 'Other');
      expect((await call(member, 'PATCH', `/api/labels/${other.id}`, { name: 'BUG' })).statusCode).toBe(409);
    });

    it('lets viewers read only, and only admins delete', async () => {
      const viewer = await addUser(app, admin.orgId, 'viewer');
      const label = await createLabel(member, 'Docs');

      expect((await call(viewer, 'GET', '/api/labels')).statusCode).toBe(200);
      expect((await call(viewer, 'POST', '/api/labels', { name: 'Nope' })).statusCode).toBe(403);
      expect((await call(member, 'DELETE', `/api/labels/${label.id}`)).statusCode).toBe(403);
      expect((await call(admin, 'DELETE', `/api/labels/${label.id}`)).statusCode).toBe(204);
    });

    it('keeps labels per organization', async () => {
      const other = await registerOrg(app);
      const theirs = await createLabel(other, 'Bug');
      await createLabel(member, 'Bug'); // same name, other org: fine

      expect((await call(admin, 'GET', '/api/labels')).json().map((l: { id: string }) => l.id)).not.toContain(theirs.id);
      expect((await call(admin, 'PATCH', `/api/labels/${theirs.id}`, { name: 'x' })).statusCode).toBe(404);
      expect((await call(admin, 'DELETE', `/api/labels/${theirs.id}`)).statusCode).toBe(404);
    });
  });

  describe('labels on tasks', () => {
    let project: { id: string };
    let task: { id: string };

    beforeEach(async () => {
      project = await createProject(app, admin);
      task = await createTask(app, admin, project.id, { title: 'Labelled' });
    });

    const boardTasks = async (qs = '') => {
      const res = await call(admin, 'GET', `/api/projects/${project.id}/tasks${qs}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      return ['todo', 'in_progress', 'in_review', 'done'].flatMap((c) => body[c]) as Array<{ id: string; labels: Array<{ name: string }> }>;
    };

    it('sets and replaces a task labels, shows them on the board, audits the change', async () => {
      const bug = await createLabel(member, 'Bug', 'red');
      const ui = await createLabel(member, 'UI', 'blue');

      const set = await setLabels(member, project.id, task.id, [ui.id, bug.id]);
      expect(set.statusCode).toBe(200);
      expect(set.json().map((l: { name: string }) => l.name)).toEqual(['Bug', 'UI']);
      expect(published.at(-1)!.message).toMatchObject({ type: 'task_updated', task_id: task.id });

      const [onBoard] = await boardTasks();
      expect(onBoard!.labels).toEqual([
        { id: bug.id, name: 'Bug', color: 'red' },
        { id: ui.id, name: 'UI', color: 'blue' },
      ]);

      await setLabels(member, project.id, task.id, [ui.id]);
      expect((await boardTasks())[0]!.labels.map((l) => l.name)).toEqual(['UI']);
      expect(await row('SELECT metadata FROM activity_log WHERE entity_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1', [task.id, 'labels_changed']))
        .toEqual({ metadata: { added: [], removed: [bug.id] } });
    });

    it('shows a rename on the board right away (the cached board is dropped)', async () => {
      const label = await createLabel(member, 'Old name');
      await setLabels(member, project.id, task.id, [label.id]);
      await boardTasks(); // now cached

      await call(member, 'PATCH', `/api/labels/${label.id}`, { name: 'New name' });

      expect((await boardTasks())[0]!.labels.map((l) => l.name)).toEqual(['New name']);
    });

    it('removes a deleted label from every task', async () => {
      const label = await createLabel(member, 'Temporary');
      await setLabels(member, project.id, task.id, [label.id]);
      await boardTasks();

      await call(admin, 'DELETE', `/api/labels/${label.id}`);

      expect((await boardTasks())[0]!.labels).toEqual([]);
    });

    it('refuses another organization label, viewers, and too many labels', async () => {
      const other = await registerOrg(app);
      const foreign = await createLabel(other, 'Theirs');
      const viewer = await addUser(app, admin.orgId, 'viewer');
      const mine = await createLabel(member, 'Mine');

      expect((await setLabels(member, project.id, task.id, [mine.id, foreign.id])).statusCode).toBe(400);
      expect((await boardTasks())[0]!.labels).toEqual([]);
      expect((await setLabels(viewer, project.id, task.id, [mine.id])).statusCode).toBe(403);
      expect((await setLabels(other, project.id, task.id, [foreign.id])).statusCode).toBe(404);

      const tooMany = Array.from({ length: 21 }, () => crypto.randomUUID());
      expect((await setLabels(member, project.id, task.id, tooMany)).statusCode).toBe(400);
    });

    it('filters the board and task search by label (any of)', async () => {
      const bug = await createLabel(member, 'Bug');
      const ui = await createLabel(member, 'UI');
      const other = await createTask(app, admin, project.id, { title: 'UI work' });
      await createTask(app, admin, project.id, { title: 'Unlabelled' });
      await setLabels(member, project.id, task.id, [bug.id]);
      await setLabels(member, project.id, other.id, [ui.id]);

      expect((await boardTasks(`?label=${bug.id}`)).map((t) => t.id)).toEqual([task.id]);
      expect((await boardTasks(`?label=${bug.id}&label=${ui.id}`)).map((t) => t.id).sort()).toEqual([task.id, other.id].sort());

      const search = (await call(admin, 'GET', `/api/tasks?label=${ui.id}`)).json();
      expect(search.items.map((t: { id: string }) => t.id)).toEqual([other.id]);
      expect(search.items[0].labels).toEqual([{ id: ui.id, name: 'UI', color: 'gray' }]);
    });

    it('counts how many tasks use each label', async () => {
      const label = await createLabel(member, 'Counted');
      await setLabels(member, project.id, task.id, [label.id]);

      const [listed] = (await call(admin, 'GET', '/api/labels')).json();
      expect(listed).toMatchObject({ name: 'Counted', task_count: 1 });
    });
  });
});
