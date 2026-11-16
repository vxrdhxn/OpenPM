import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { published } from './fakes';
import { addUser, createProject, createTask, registerOrg, startApp, type Actor, type App } from './harness';

/** Phase I: in-app notifications and @mentions, against real Postgres. */
describe('notifications (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let ada: Actor;
  let bo: Actor;
  let project: { id: string };

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    ada = await addUser(app, admin.orgId, 'member');
    bo = await addUser(app, admin.orgId, 'member');
    project = await createProject(app, admin);
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: actor.auth, payload });
  const inbox = async (actor: Actor, qs = '') => (await call(actor, 'GET', `/api/notifications${qs}`)).json().items as Array<Record<string, any>>;
  const unread = async (actor: Actor) => (await call(actor, 'GET', '/api/notifications/unread-count')).json().count as number;
  const commentsUrl = (taskId: string) => `/api/projects/${project.id}/tasks/${taskId}/comments`;

  describe('task events', () => {
    it('notifies the assignee on create, with who and what, and announces it without content', async () => {
      const task = await createTask(app, admin, project.id, { title: 'Ship it', assignee_id: ada.userId });

      const [n] = await inbox(ada);
      expect(n).toMatchObject({ type: 'task_assigned', task_id: task.id, project_id: project.id, actor_id: admin.userId, task_title: 'Ship it', read_at: null });
      expect(await unread(ada)).toBe(1);
      expect(published.some((p) => JSON.stringify(p.message) === JSON.stringify({ type: 'notification', user_ids: [ada.userId] }))).toBe(true);
    });

    it('never notifies people about their own actions', async () => {
      await createTask(app, ada, project.id, { assignee_id: ada.userId });

      expect(await unread(ada)).toBe(0);
    });

    it('notifies a new assignee on reassignment, and the assignee and creator on a status change', async () => {
      const task = await createTask(app, ada, project.id, { assignee_id: ada.userId }); // ada creates and owns it
      const url = `/api/projects/${project.id}/tasks/${task.id}`;

      await call(admin, 'PATCH', url, { assignee_id: bo.userId });
      expect((await inbox(bo))[0]).toMatchObject({ type: 'task_assigned' });

      await call(admin, 'PATCH', url, { status: 'in_review' });
      expect((await inbox(bo))[0]).toMatchObject({ type: 'status_changed', data: { from: 'todo', to: 'in_review' } });
      expect((await inbox(ada))[0]).toMatchObject({ type: 'status_changed' }); // the creator
      expect(await unread(admin)).toBe(0);
    });

    it('sends one notification, not two, when a task is reassigned and moved at once', async () => {
      const task = await createTask(app, admin, project.id);

      await call(admin, 'PATCH', `/api/projects/${project.id}/tasks/${task.id}`, { assignee_id: bo.userId, status: 'in_progress' });

      expect((await inbox(bo)).map((n) => n.type)).toEqual(['task_assigned']);
    });
  });

  describe('comments and mentions', () => {
    it('notifies mentioned people, and the assignee and creator once each', async () => {
      const task = await createTask(app, ada, project.id, { assignee_id: bo.userId });

      const res = await call(admin, 'POST', commentsUrl(task.id), { body: '@Ada can you look?  Thanks', mention_ids: [ada.userId] });

      expect(res.statusCode).toBe(201);
      expect(res.json().mentions).toEqual([{ id: ada.userId, name: 'member user' }]);
      // Ada (creator) is mentioned: one "mentioned", no extra "commented".
      expect((await inbox(ada)).map((n) => n.type)).toEqual(['mentioned']);
      expect((await inbox(ada))[0]).toMatchObject({ comment_id: res.json().id, data: { excerpt: '@Ada can you look? Thanks' } });
      // Bo (assignee) also has the earlier task_assigned; exactly one 'commented' for this comment.
      expect((await inbox(bo)).map((n) => n.type)).toEqual(['commented', 'task_assigned']);
    });

    it('notifies only newly mentioned people when a comment is edited', async () => {
      const task = await createTask(app, admin, project.id);
      const id = (await call(admin, 'POST', commentsUrl(task.id), { body: 'hi @Ada', mention_ids: [ada.userId] })).json().id;

      await call(admin, 'PATCH', `${commentsUrl(task.id)}/${id}`, { body: 'hi @Ada and @Bo', mention_ids: [ada.userId, bo.userId] });

      expect((await inbox(ada)).map((n) => n.type)).toEqual(['mentioned']);
      expect((await inbox(bo)).map((n) => n.type)).toEqual(['mentioned']);
    });

    it('refuses to mention someone outside the organization, or a removed member', async () => {
      const task = await createTask(app, admin, project.id);
      const outsider = await registerOrg(app);

      const foreign = await call(admin, 'POST', commentsUrl(task.id), { body: 'hey', mention_ids: [outsider.userId] });
      expect(foreign.statusCode).toBe(400);

      await call(admin, 'DELETE', `/api/members/${bo.userId}`);
      const removed = await call(admin, 'POST', commentsUrl(task.id), { body: 'hey', mention_ids: [bo.userId] });
      expect(removed.statusCode).toBe(400);
      expect(await unread(outsider)).toBe(0);
    });
  });

  describe('reading', () => {
    it('marks one read, then all read, and filters unread', async () => {
      await createTask(app, admin, project.id, { assignee_id: ada.userId });
      await createTask(app, admin, project.id, { assignee_id: ada.userId });
      const [first] = await inbox(ada);

      expect((await call(ada, 'POST', `/api/notifications/${first!.id}/read`, {})).statusCode).toBe(204);
      expect(await unread(ada)).toBe(1);
      expect(await inbox(ada, '?unread=true')).toHaveLength(1);

      expect((await call(ada, 'POST', '/api/notifications/read-all', {})).json()).toEqual({ marked: 1 });
      expect(await unread(ada)).toBe(0);
    });

    it("never shows or marks someone else's notifications", async () => {
      await createTask(app, admin, project.id, { assignee_id: ada.userId });
      const [mine] = await inbox(ada);

      expect(await inbox(bo)).toEqual([]);
      expect((await call(bo, 'POST', `/api/notifications/${mine!.id}/read`, {})).statusCode).toBe(404);
      expect(await unread(ada)).toBe(1);

      const outsider = await registerOrg(app);
      expect((await call(outsider, 'POST', `/api/notifications/${mine!.id}/read`, {})).statusCode).toBe(404);
    });

    it('drops notifications with their task', async () => {
      const task = await createTask(app, admin, project.id, { assignee_id: ada.userId });

      await call(admin, 'DELETE', `/api/projects/${project.id}/tasks/${task.id}`);

      expect(await unread(ada)).toBe(0);
    });

    it('requires authentication', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
    });
  });
});
