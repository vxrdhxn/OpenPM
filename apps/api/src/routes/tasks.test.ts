import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));
vi.mock('../cache/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), subscribe: vi.fn() },
}));
const { queueAdd } = vi.hoisted(() => ({ queueAdd: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () { return { add: queueAdd }; }),
}));
const { getStorage } = vi.hoisted(() => ({ getStorage: vi.fn() }));
vi.mock('../storage', () => ({ getStorage }));

import { db } from '../db/client';
import { cache } from '../cache/redis';
import authPlugin from '../plugins/auth';
import { genReqId } from '../logger';
import taskRoutes from './tasks';

const mockClient = { query: vi.fn(), release: vi.fn() };
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const sqlOf = (c: unknown[] | undefined) => String(c?.[0]);
const P = '11111111-1111-1111-1111-111111111111';
const T = '22222222-2222-2222-2222-222222222222';

describe('Task routes lifecycle', () => {
  let app: ReturnType<typeof Fastify>;
  const auth = (role = 'member', org = 'org-1') => ({
    authorization: `Bearer ${app.jwt.sign({ user_id: 'user-1', org_id: org, role })}`,
  });
  const sqls = () => mockClient.query.mock.calls.map(sqlOf);

  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify();
    await app.register(authPlugin);
    await app.register(taskRoutes, { prefix: '/projects' });
    await app.ready();
    vi.mocked(db.getClient).mockResolvedValue(mockClient as never);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('create', () => {
    it('inserts the task, logs activity, enqueues a job, clears cache and publishes an event', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM projects')) return rows([{ id: P }]);
        if (sql.startsWith('INSERT INTO tasks')) return rows([{ id: T, title: 'Do it' }]);
        return rows();
      });

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${P}/tasks`,
        headers: auth(),
        payload: { title: 'Do it' },
      });

      expect(res.statusCode).toBe(201);
      expect(sqls()).toContain('COMMIT');
      expect(sqls().some((s) => s.startsWith('INSERT INTO activity_log'))).toBe(true);
      expect(queueAdd).toHaveBeenCalledWith('task_created', expect.objectContaining({ task_id: T, org_id: 'org-1' }));
      expect(cache.del).toHaveBeenCalledWith(`org:org-1:project:${P}:tasks`);
      expect(cache.publish).toHaveBeenCalledWith(
        'org:org-1:updates',
        expect.objectContaining({ type: 'task_created' })
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('scopes the project check and insert to the JWT org', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT id FROM projects') ? rows() : rows()
      );

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${P}/tasks`,
        headers: auth('member', 'org-A'),
        payload: { title: 'x' },
      });

      expect(res.statusCode).toBe(404);
      const check = mockClient.query.mock.calls.find((c) => sqlOf(c).startsWith('SELECT id FROM projects'));
      expect(check![1]).toEqual([P, 'org-A']);
      expect(sqls()).toContain('ROLLBACK');
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('rejects an empty title and an invalid priority', async () => {
      for (const payload of [{ title: '' }, { title: 'x', priority: 'huge' }, {}]) {
        const res = await app.inject({
          method: 'POST',
          url: `/projects/${P}/tasks`,
          headers: auth(),
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it('forbids viewers from creating tasks', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${P}/tasks`,
        headers: auth('viewer'),
        payload: { title: 'x' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('list', () => {
    it('serves from cache when present', async () => {
      const cached = { todo: [], in_progress: [], in_review: [], done: [] };
      vi.mocked(cache.get).mockResolvedValue(cached);

      const res = await app.inject({ method: 'GET', url: `/projects/${P}/tasks`, headers: auth('viewer') });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(cached);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('groups tasks by status and caches the result on a miss', async () => {
      vi.mocked(cache.get).mockResolvedValue(null);
      vi.mocked(db.query)
        .mockResolvedValueOnce([{ id: P }])
        .mockResolvedValueOnce([
          { id: 'a', status: 'todo' },
          { id: 'b', status: 'done' },
          { id: 'c', status: 'todo' },
        ]);

      const res = await app.inject({ method: 'GET', url: `/projects/${P}/tasks`, headers: auth('viewer') });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.todo.map((t: { id: string }) => t.id)).toEqual(['a', 'c']);
      expect(body.done).toHaveLength(1);
      expect(body.in_progress).toEqual([]);
      expect(cache.set).toHaveBeenCalledWith(`org:org-1:project:${P}:tasks`, body, 60);
    });

    it('returns 404 when the project is not in the caller org', async () => {
      vi.mocked(cache.get).mockResolvedValue(null);
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: `/projects/${P}/tasks`, headers: auth('viewer') });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('update', () => {
    const url = `/projects/${P}/tasks/${T}`;

    it('updates, records the status transition and notifies subscribers', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT status FROM tasks')) return rows([{ status: 'todo' }]);
        if (sql.startsWith('UPDATE tasks')) return rows([{ id: T, status: 'done' }]);
        return rows();
      });

      const res = await app.inject({ method: 'PATCH', url, headers: auth(), payload: { status: 'done' } });

      expect(res.statusCode).toBe(200);
      const log = mockClient.query.mock.calls.find((c) => sqlOf(c).startsWith('INSERT INTO activity_log'));
      expect(JSON.parse(log![1][5])).toMatchObject({ from: 'todo', to: 'done' });
      expect(cache.publish).toHaveBeenCalledWith('org:org-1:updates', expect.objectContaining({ type: 'task_updated' }));
      expect(cache.del).toHaveBeenCalled();
    });

    it('rejects an empty body and an invalid status', async () => {
      const empty = await app.inject({ method: 'PATCH', url, headers: auth(), payload: {} });
      expect(empty.statusCode).toBe(400);
      const bad = await app.inject({ method: 'PATCH', url, headers: auth(), payload: { status: 'bogus' } });
      expect(bad.statusCode).toBe(400);
    });

    it('returns 404 and rolls back for a task outside the tenant', async () => {
      mockClient.query.mockImplementation(async () => rows());

      const res = await app.inject({ method: 'PATCH', url, headers: auth(), payload: { title: 'x' } });

      expect(res.statusCode).toBe(404);
      expect(sqls()).toContain('ROLLBACK');
      expect(cache.publish).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const url = `/projects/${P}/tasks/${T}`;

    it('requires admin', async () => {
      const res = await app.inject({ method: 'DELETE', url, headers: auth('member') });
      expect(res.statusCode).toBe(403);
    });

    it('deletes within the tenant, logs it and clears the cache', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.startsWith('DELETE FROM tasks') ? rows([{ id: T }]) : rows()
      );

      const res = await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

      expect(res.statusCode).toBe(204);
      const del = mockClient.query.mock.calls.find((c) => sqlOf(c).startsWith('DELETE FROM tasks'));
      expect(del![1]).toEqual([T, P, 'org-9']);
      expect(cache.del).toHaveBeenCalledWith(`org:org-9:project:${P}:tasks`);
    });

    it('publishes a task_deleted event to the caller org so other boards update', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.startsWith('DELETE FROM tasks') ? rows([{ id: T }]) : rows()
      );

      await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

      expect(cache.publish).toHaveBeenCalledTimes(1);
      expect(cache.publish).toHaveBeenCalledWith('org:org-9:updates', {
        type: 'task_deleted',
        project_id: P,
        task_id: T,
      });
    });

    it('returns 404 when nothing was deleted', async () => {
      mockClient.query.mockImplementation(async () => rows());
      const res = await app.inject({ method: 'DELETE', url, headers: auth('admin') });
      expect(res.statusCode).toBe(404);
    });

    describe('attachment files', () => {
      const storage = { delete: vi.fn() };
      const withAttachments = (keys: string[]) =>
        mockClient.query.mockImplementation(async (sql: string) => {
          if (sql.startsWith('DELETE FROM task_attachments')) return rows(keys.map((storage_key) => ({ storage_key })));
          if (sql.startsWith('DELETE FROM tasks')) return rows([{ id: T }]);
          return rows();
        });

      beforeEach(() => {
        storage.delete.mockReset().mockResolvedValue(undefined);
        getStorage.mockReturnValue(storage);
      });

      it('removes the files from storage after the task is deleted', async () => {
        withAttachments(['org/org-9/tasks/t/k1', 'org/org-9/tasks/t/k2']);

        const res = await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        expect(res.statusCode).toBe(204);
        expect(storage.delete).toHaveBeenCalledTimes(2);
        expect(storage.delete).toHaveBeenCalledWith('org/org-9/tasks/t/k1');
        expect(storage.delete).toHaveBeenCalledWith('org/org-9/tasks/t/k2');
      });

      it('collects the keys inside the transaction, scoped to the task and org, before deleting the task', async () => {
        withAttachments(['k1']);

        await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        const order = sqls();
        const attachmentsAt = order.findIndex((s) => s.startsWith('DELETE FROM task_attachments'));
        const taskAt = order.findIndex((s) => s.startsWith('DELETE FROM tasks'));
        expect(attachmentsAt).toBeGreaterThan(order.indexOf('BEGIN'));
        expect(attachmentsAt).toBeLessThan(taskAt);
        expect(taskAt).toBeLessThan(order.indexOf('COMMIT'));
        const call = mockClient.query.mock.calls[attachmentsAt]!;
        expect(sqlOf(call)).toContain('RETURNING storage_key');
        expect(call[1]).toEqual([T, 'org-9']);
      });

      it('does not delete files until the transaction has committed', async () => {
        withAttachments(['k1']);
        mockClient.query.mockImplementation(async (sql: string) => {
          if (sql.startsWith('DELETE FROM task_attachments')) return rows([{ storage_key: 'k1' }]);
          if (sql.startsWith('DELETE FROM tasks')) return rows(); // task not found -> rollback
          return rows();
        });

        const res = await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        expect(res.statusCode).toBe(404);
        expect(storage.delete).not.toHaveBeenCalled(); // the rows were rolled back; keep the files
      });

      it('still succeeds when storage fails (the files become logged orphans)', async () => {
        withAttachments(['k1', 'k2']);
        storage.delete.mockRejectedValue(new Error('storage down'));

        const res = await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        expect(res.statusCode).toBe(204);
        expect(storage.delete).toHaveBeenCalledTimes(2); // one failure does not stop the others
      });

      it('works when attachment storage is not configured', async () => {
        getStorage.mockReturnValue(null);
        withAttachments(['k1']);

        const res = await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        expect(res.statusCode).toBe(204);
      });

      it('does not touch storage when the task had no attachments', async () => {
        withAttachments([]);

        await app.inject({ method: 'DELETE', url, headers: auth('admin', 'org-9') });

        expect(storage.delete).not.toHaveBeenCalled();
      });
    });

    it('publishes nothing when the delete fails or finds no task', async () => {
      mockClient.query.mockImplementation(async () => rows());
      await app.inject({ method: 'DELETE', url, headers: auth('admin') });
      expect(cache.publish).not.toHaveBeenCalled();
    });
  });

  describe('job correlation', () => {
    it('hands the request id to the background job so logs can be followed into the worker', async () => {
      const wired = Fastify({ genReqId, requestIdLogLabel: 'request_id' }); // same wiring as src/index.ts
      await wired.register(authPlugin);
      await wired.register(taskRoutes, { prefix: '/projects' });
      await wired.ready();
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM projects')) return rows([{ id: P }]);
        if (sql.startsWith('INSERT INTO tasks')) return rows([{ id: T, title: 'x' }]);
        return rows();
      });
      const token = wired.jwt.sign({ user_id: 'user-1', org_id: 'org-1', role: 'member' });

      const res = await wired.inject({
        method: 'POST',
        url: `/projects/${P}/tasks`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'upstream-req-0001' },
        payload: { title: 'x' },
      });
      await wired.close();

      expect(res.statusCode).toBe(201);
      expect(queueAdd).toHaveBeenCalledWith('task_created', expect.objectContaining({ request_id: 'upstream-req-0001' }));
    });
  });

  // Regression: PATCH built its SET clause from request-body keys. With the production
  // Fastify config (removeAdditional: false, see src/index.ts) unknown keys reached the SQL,
  // allowing SQL injection via a key name and writes to protected columns such as org_id.
  describe('update: unknown / protected fields (production ajv config)', () => {
    let strictApp: ReturnType<typeof Fastify>;
    const url = `/projects/${P}/tasks/${T}`;

    beforeEach(async () => {
      strictApp = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
      await strictApp.register(authPlugin);
      await strictApp.register(taskRoutes, { prefix: '/projects' });
      await strictApp.ready();
    });

    afterEach(async () => {
      await strictApp.close();
    });

    const patch = (payload: Record<string, unknown>) =>
      strictApp.inject({
        method: 'PATCH',
        url,
        headers: {
          authorization: `Bearer ${strictApp.jwt.sign({ user_id: 'user-1', org_id: 'org-1', role: 'member' })}`,
        },
        payload,
      });

    it.each([
      ['a protected column', { org_id: 'org-other' }],
      ['another protected column', { created_by: 'someone-else' }],
      ['an unknown column', { nonexistent: 'x' }],
      ['a SQL-injection key', { title: 'x', "status = 'done', org_id": 'org-other' }],
      ['a valid field mixed with an unknown one', { title: 'ok', org_id: 'org-other' }],
    ])('rejects %s with 400 before touching the database', async (_label, payload) => {
      const res = await patch(payload);

      expect(res.statusCode).toBe(400);
      expect(db.getClient).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('only ever interpolates whitelisted column names into the UPDATE', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT status FROM tasks')) return rows([{ status: 'todo' }]);
        if (sql.startsWith('UPDATE tasks')) return rows([{ id: T }]);
        return rows();
      });

      const res = await patch({ title: 'New', description: 'd', status: 'done', priority: 'high' });

      expect(res.statusCode).toBe(200);
      const update = mockClient.query.mock.calls.find((c) => sqlOf(c).startsWith('UPDATE tasks'));
      expect(sqlOf(update)).toBe(
        'UPDATE tasks SET title = $1, description = $2, status = $3, priority = $4, updated_at = NOW() ' +
          'WHERE id = $5 AND project_id = $6 AND org_id = $7 RETURNING *'
      );
      expect(update![1]).toEqual(['New', 'd', 'done', 'high', T, P, 'org-1']);
    });
  });
});
