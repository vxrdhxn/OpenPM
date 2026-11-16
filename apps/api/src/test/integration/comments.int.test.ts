import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { published } from './fakes';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/** Phase I: task comments against real Postgres. */
describe('comments (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let member: Actor;
  let project: { id: string };
  let task: { id: string };
  let url: string;

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    member = await addUser(app, admin.orgId, 'member');
    project = await createProject(app, admin);
    task = await createTask(app, admin, project.id);
    url = `/api/projects/${project.id}/tasks/${task.id}/comments`;
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, headers: actor.auth, payload });
  const post = (actor: Actor, body: string) => call(actor, 'POST', url, { body });

  it('posts a comment with its author, publishes it and audits it without the text', async () => {
    const res = await post(member, 'Looks good to me');

    expect(res.statusCode).toBe(201);
    const comment = res.json();
    expect(comment).toMatchObject({ task_id: task.id, body: 'Looks good to me', author_id: member.userId, author_name: 'member user', author_removed: false, edited_at: null });

    expect(published.at(-1)).toEqual({
      channel: `org:${admin.orgId}:updates`,
      message: { type: 'comment_created', project_id: project.id, task_id: task.id, comment: expect.objectContaining({ id: comment.id }) },
    });

    const log = await row<{ action: string; metadata: Record<string, unknown> }>(
      'SELECT action, metadata FROM activity_log WHERE entity_type = $1 AND entity_id = $2',
      ['comment', comment.id]
    );
    expect(log).toEqual({ action: 'created', metadata: { task_id: task.id } });
  });

  it('stores markup as plain text, exactly as written', async () => {
    const body = '<img src=x onerror=alert(1)> **not markdown** \n second line';

    const res = await post(member, body);

    expect(res.json().body).toBe(body);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t '],
    ['too long', 'x'.repeat(10_001)],
  ])('rejects a %s comment', async (_label, body) => {
    expect((await post(member, body)).statusCode).toBe(400);
  });

  it('lists newest first, paginated, without repeats', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await post(member, `c${i}`)).json().id);

    const first = (await call(admin, 'GET', `${url}?limit=2`)).json();
    expect(first.items.map((c: { id: string }) => c.id)).toEqual([ids[4], ids[3]]);

    const seen = [...first.items];
    let cursor = first.next_cursor;
    while (cursor) {
      const page = (await call(admin, 'GET', `${url}?limit=2&cursor=${cursor}`)).json();
      seen.push(...page.items);
      cursor = page.next_cursor;
    }
    expect(seen.map((c: { id: string }) => c.id)).toEqual([...ids].reverse());
  });

  describe('permissions', () => {
    it('lets viewers read but not write', async () => {
      const viewer = await addUser(app, admin.orgId, 'viewer');
      await post(member, 'hello');

      expect((await call(viewer, 'GET', url)).statusCode).toBe(200);
      expect((await post(viewer, 'hi')).statusCode).toBe(403);
    });

    it('lets only the author edit, and marks the comment edited', async () => {
      const id = (await post(member, 'first draft')).json().id;

      expect((await call(admin, 'PATCH', `${url}/${id}`, { body: 'hijacked' })).statusCode).toBe(403);

      const edited = await call(member, 'PATCH', `${url}/${id}`, { body: 'final' });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().body).toBe('final');
      expect(edited.json().edited_at).not.toBeNull();
      expect(published.at(-1)!.message).toMatchObject({ type: 'comment_updated', task_id: task.id });
    });

    it('lets the author or an admin delete, but not another member', async () => {
      const other = await addUser(app, admin.orgId, 'member');
      const mine = (await post(member, 'mine')).json().id;
      const moderated = (await post(member, 'needs moderation')).json().id;

      expect((await call(other, 'DELETE', `${url}/${mine}`)).statusCode).toBe(403);
      expect((await call(member, 'DELETE', `${url}/${mine}`)).statusCode).toBe(204);
      expect((await call(admin, 'DELETE', `${url}/${moderated}`)).statusCode).toBe(204);

      expect((await call(admin, 'GET', url)).json().items).toEqual([]);
      expect(published.at(-1)!.message).toEqual({ type: 'comment_deleted', project_id: project.id, task_id: task.id, comment_id: moderated });
      expect(await row('SELECT metadata FROM activity_log WHERE entity_id = $1 AND action = $2', [moderated, 'deleted']))
        .toEqual({ metadata: { task_id: task.id, author_id: member.userId, moderated: true } });
    });
  });

  describe('scoping', () => {
    it('hides another organization comments and tasks behind 404', async () => {
      const other = await registerOrg(app);
      const id = (await post(member, 'internal')).json().id;

      expect((await call(other, 'GET', url)).statusCode).toBe(404);
      expect((await post(other, 'intrusion')).statusCode).toBe(404);
      expect((await call(other, 'PATCH', `${url}/${id}`, { body: 'x' })).statusCode).toBe(404);
      expect((await call(other, 'DELETE', `${url}/${id}`)).statusCode).toBe(404);
      expect(await row('SELECT body FROM task_comments WHERE id = $1', [id])).toEqual({ body: 'internal' });
    });

    it('requires the task to belong to the project in the URL', async () => {
      const otherProject = await createProject(app, admin);
      const id = (await post(member, 'here')).json().id;
      const wrong = `/api/projects/${otherProject.id}/tasks/${task.id}/comments`;

      expect((await call(admin, 'GET', wrong)).statusCode).toBe(404);
      expect((await call(member, 'PATCH', `${wrong}/${id}`, { body: 'x' })).statusCode).toBe(404);
    });

    it('does not reach a comment through another task of the same org', async () => {
      const otherTask = await createTask(app, admin, project.id);
      const id = (await post(member, 'on the first task')).json().id;

      const res = await call(member, 'DELETE', `/api/projects/${project.id}/tasks/${otherTask.id}/comments/${id}`);

      expect(res.statusCode).toBe(404);
    });
  });

  it('keeps a removed member comments, flagged as removed', async () => {
    await post(member, 'before I left');
    await call(admin, 'DELETE', `/api/members/${member.userId}`);

    const [comment] = (await call(admin, 'GET', url)).json().items;

    expect(comment).toMatchObject({ body: 'before I left', author_name: 'member user', author_removed: true });
  });

  it('deletes the thread with its task', async () => {
    await post(member, 'gone soon');

    expect((await call(admin, 'DELETE', `/api/projects/${project.id}/tasks/${task.id}`)).statusCode).toBe(204);

    const left = await row<{ n: string }>('SELECT count(*) AS n FROM task_comments WHERE task_id = $1', [task.id]);
    expect(Number(left!.n)).toBe(0);
  });
});
