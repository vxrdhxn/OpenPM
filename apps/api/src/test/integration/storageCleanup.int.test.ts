import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** An in-memory object store whose deletes can be made to fail. */
const store = vi.hoisted(() => {
  const objects = new Set<string>();
  const state = { failing: false };
  return {
    objects,
    state,
    storage: {
      presignUpload: async () => ({ url: 'http://storage.test/upload', headers: {} }),
      presignDownload: async () => 'http://storage.test/download',
      head: async () => null,
      readPrefix: async () => new Uint8Array(),
      delete: async (key: string) => {
        if (state.failing) throw new Error('storage down');
        objects.delete(key);
      },
    },
  };
});
vi.mock('../../storage', () => ({ getStorage: () => store.storage }));

import { db } from '../../db/client';
import { sweepStorage } from '../../attachments/cleanup';
import { createProject, createTask, registerOrg, row, startApp, unique, type Actor, type App } from './harness';

/** Attachment files outside the database: owed deletions and the storage sweep (docs/attachments.md). */
describe('storage cleanup (real Postgres)', () => {
  let app: App;
  let owner: Actor;
  let projectId: string;
  const log = { error: () => undefined, warn: () => undefined, info: () => undefined };

  beforeEach(async () => {
    store.state.failing = false;
    store.objects.clear();
    app = await startApp();
    owner = await registerOrg(app);
    projectId = (await createProject(app, owner)).id;
  });

  afterEach(async () => {
    await app.close();
  });

  /** An attachment row plus its object in the fake store. */
  async function attach(taskId: string, status: 'pending' | 'ready', ageMinutes = 0): Promise<string> {
    const key = `org/${owner.orgId}/tasks/${taskId}/${unique()}`;
    await db.query(
      `INSERT INTO task_attachments (org_id, task_id, uploaded_by, filename, content_type, size_bytes, storage_key, status, created_at)
       VALUES ($1, $2, $3, 'f.png', 'image/png', 10, $4, $5, NOW() - make_interval(mins => $6))`,
      [owner.orgId, taskId, owner.userId, key, status, ageMinutes]
    );
    store.objects.add(key);
    return key;
  }
  const owed = async (key: string) => row<{ attempts: number }>('SELECT attempts FROM storage_deletions WHERE storage_key = $1', [key]);
  const deleteTask = (taskId: string) =>
    app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/tasks/${taskId}`, headers: owner.auth });

  it('deletes a task’s files after the commit and owes nothing afterwards', async () => {
    const task = await createTask(app, owner, projectId);
    const key = await attach(task.id, 'ready');

    expect((await deleteTask(task.id)).statusCode).toBe(204);
    expect(store.objects.has(key)).toBe(false);
    expect(await owed(key)).toBeUndefined();
  });

  it('keeps a failed delete owed, backs off, and the sweep finishes it once storage is back', async () => {
    const task = await createTask(app, owner, projectId);
    const key = await attach(task.id, 'ready');
    store.state.failing = true;

    expect((await deleteTask(task.id)).statusCode).toBe(204); // the user's delete still succeeds
    expect(store.objects.has(key)).toBe(true);
    expect(await owed(key)).toEqual({ attempts: 0 });

    // Still failing: postponed, with the attempt counted.
    expect(await sweepStorage(log)).toMatchObject({ deleted: 0, failed: 1 });
    expect(await owed(key)).toEqual({ attempts: 1 });
    // Not due yet, so the next sweep leaves it alone.
    expect(await sweepStorage(log)).toMatchObject({ failed: 0 });

    store.state.failing = false;
    await db.query('UPDATE storage_deletions SET next_attempt_at = NOW() WHERE storage_key = $1', [key]);
    expect(await sweepStorage(log)).toMatchObject({ deleted: 1 });
    expect(store.objects.has(key)).toBe(false);
    expect(await owed(key)).toBeUndefined();
  });

  it('removes uploads abandoned for over an hour, and only those', async () => {
    const task = await createTask(app, owner, projectId);
    const abandoned = await attach(task.id, 'pending', 120);
    const inProgress = await attach(task.id, 'pending', 2);
    const old = await attach(task.id, 'ready', 120);

    expect(await sweepStorage(log)).toMatchObject({ abandoned: 1, deleted: 1 });
    expect(await row('SELECT 1 FROM task_attachments WHERE storage_key = $1', [abandoned])).toBeUndefined();
    expect(store.objects.has(abandoned)).toBe(false);
    for (const key of [inProgress, old]) {
      expect(await row('SELECT 1 FROM task_attachments WHERE storage_key = $1', [key])).toBeDefined();
      expect(store.objects.has(key)).toBe(true);
    }
  });

  it('keeps owed deletions when the whole organization is deleted', async () => {
    const task = await createTask(app, owner, projectId);
    const key = await attach(task.id, 'ready');
    store.state.failing = true;

    const slug = (await row<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [owner.orgId]))!.slug;
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/organization',
      headers: owner.auth,
      payload: { confirm_slug: slug, password: 'password123' },
    });
    expect(res.statusCode).toBe(204);
    expect(await owed(key)).toBeDefined();

    store.state.failing = false;
    await db.query('UPDATE storage_deletions SET next_attempt_at = NOW() WHERE storage_key = $1', [key]);
    await sweepStorage(log);
    expect(store.objects.has(key)).toBe(false);
  });

  it('lets concurrent sweeps share the work without deleting anything twice', async () => {
    const task = await createTask(app, owner, projectId);
    for (let i = 0; i < 5; i++) await attach(task.id, 'pending', 120);

    const results = await Promise.all([sweepStorage(log), sweepStorage(log), sweepStorage(log)]);
    expect(results.reduce((n, r) => n + r.abandoned, 0)).toBe(5);
    expect(store.objects.size).toBe(0);
  });
});
