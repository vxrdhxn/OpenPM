import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

const { getStorage } = vi.hoisted(() => ({ getStorage: vi.fn() }));
vi.mock('../storage', () => ({ getStorage }));

import { db } from '../db/client';
import { config } from '../config';
import authPlugin from '../plugins/auth';
import attachmentRoutes from './attachments';

const P = '11111111-1111-1111-1111-111111111111';
const T = '22222222-2222-2222-2222-222222222222';
const A = '33333333-3333-3333-3333-333333333333';
const KEY = `org/org-1/tasks/${T}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
const base = `/projects/${P}/tasks/${T}/attachments`;

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const sqlOf = (c: readonly unknown[] | undefined) => String(c?.[0]);

const row = (over: Record<string, unknown> = {}) => ({
  id: A,
  task_id: T,
  filename: 'diagram.png',
  content_type: 'image/png',
  size_bytes: '123', // pg returns BIGINT as a string
  storage_key: KEY,
  status: 'ready',
  uploaded_by: 'user-1',
  ...over,
});

interface DbScript {
  task?: boolean;
  count?: number;
  attachment?: Record<string, unknown> | null;
  list?: unknown[];
}

/** Answers db.query by SQL shape, so tests read as scenarios rather than call sequences. */
function scriptDb({ task = true, count = 0, attachment = null, list = [] }: DbScript = {}) {
  vi.mocked(db.query).mockImplementation((async (sql: string) => {
    if (sql.startsWith('SELECT id FROM tasks')) return task ? [{ id: T }] : [];
    if (sql.includes('COUNT(*)')) return [{ count: String(count) }];
    if (sql.startsWith('SELECT a.id')) return attachment ? [attachment] : [];
    if (sql.startsWith('INSERT INTO task_attachments')) return [row({ status: 'pending', storage_key: undefined })];
    if (sql.startsWith('UPDATE task_attachments')) return [row({ storage_key: undefined })];
    if (sql.startsWith('SELECT id, task_id') && sql.includes('ORDER BY')) return list;
    if (sql.startsWith('SELECT id, task_id')) return [row({ storage_key: undefined })];
    return [];
  }) as never);
}

describe('Attachment routes', () => {
  let app: ReturnType<typeof Fastify>;
  const storage = {
    presignUpload: vi.fn(),
    presignDownload: vi.fn(),
    head: vi.fn(),
    readPrefix: vi.fn(),
    delete: vi.fn(),
  };

  // Same Ajv options as production (src/index.ts): unknown keys are not stripped.
  beforeEach(async () => {
    vi.resetAllMocks();
    getStorage.mockReturnValue(storage);
    storage.presignUpload.mockResolvedValue({
      url: 'http://storage.test/upload?sig=1',
      headers: { 'Content-Type': 'image/png' },
    });
    storage.presignDownload.mockResolvedValue('http://storage.test/download?sig=2');
    storage.head.mockResolvedValue({ size: 123, contentType: 'image/png' });
    storage.readPrefix.mockResolvedValue(PNG_HEAD);
    storage.delete.mockResolvedValue(undefined);

    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await app.register(authPlugin);
    await app.register(attachmentRoutes, { prefix: '/projects' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = (role = 'member', userId = 'user-1', org = 'org-1') => ({
    authorization: `Bearer ${app.jwt.sign({ user_id: userId, org_id: org, role })}`,
  });
  const inject = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    opts: { role?: string; user?: string; org?: string; payload?: unknown } = {}
  ) =>
    app.inject({
      method,
      url,
      headers: headers(opts.role, opts.user, opts.org),
      payload: opts.payload as never,
    });
  const request = (payload: Record<string, unknown>, opts: { role?: string; org?: string } = {}) =>
    inject('POST', base, { ...opts, payload });
  const body = { filename: 'diagram.png', content_type: 'image/png', size: 123 };
  const dbSql = () => vi.mocked(db.query).mock.calls.map(sqlOf);

  describe('when storage is not configured', () => {
    it.each([
      ['POST', base],
      ['POST', `${base}/${A}/complete`],
      ['GET', `${base}/${A}/download`],
      ['DELETE', `${base}/${A}`],
    ] as const)('%s %s returns 503 without touching the database', async (method, url) => {
      getStorage.mockReturnValue(null);

      const res = await inject(method, url, { payload: method === 'POST' && url === base ? body : undefined });

      expect(res.statusCode).toBe(503);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('authentication and roles', () => {
    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: base });
      expect(res.statusCode).toBe(401);
    });

    it.each([
      ['POST', base],
      ['POST', `${base}/${A}/complete`],
      ['DELETE', `${base}/${A}`],
    ] as const)('forbids viewers from %s %s', async (method, url) => {
      const res = await inject(method, url, { role: 'viewer', payload: url === base ? body : undefined });
      expect(res.statusCode).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('lets viewers list and download', async () => {
      scriptDb({ attachment: row(), list: [] });

      expect((await inject('GET', base, { role: 'viewer' })).statusCode).toBe(200);
      expect((await inject('GET', `${base}/${A}/download`, { role: 'viewer' })).statusCode).toBe(200);
    });
  });

  describe('POST (request upload URL)', () => {
    it('creates a pending row and returns a presigned upload', async () => {
      scriptDb({ count: 2 });

      const res = await request(body);

      expect(res.statusCode).toBe(201);
      expect(res.json().upload).toEqual({
        method: 'PUT',
        url: 'http://storage.test/upload?sig=1',
        headers: { 'Content-Type': 'image/png' },
        expires_in: 300,
      });
      expect(res.json().attachment).toMatchObject({ id: A, status: 'pending' });
    });

    it('uses one random, user-input-free key for both the signature and the row', async () => {
      scriptDb();

      await request({ ...body, filename: '../../etc/passwd.png' });

      const presigned = storage.presignUpload.mock.calls[0]![0] as { key: string; contentType: string; size: number };
      expect(presigned).toMatchObject({ contentType: 'image/png', size: 123, expiresInSeconds: 300 });
      expect(presigned.key).toMatch(new RegExp(`^org/org-1/tasks/${T}/[0-9a-f-]{36}$`));
      expect(presigned.key).not.toMatch(/passwd|\.\./);

      const insert = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).startsWith('INSERT INTO task_attachments'))!;
      // [org, task, uploader, filename, type, size, key]
      expect(insert[1]).toEqual(['org-1', T, 'user-1', 'passwd.png', 'image/png', 123, presigned.key]);
    });

    it('never returns the storage key to the client', async () => {
      scriptDb();
      const res = await request(body);
      expect(res.body).not.toContain('org/org-1');
      expect(res.body).not.toContain('storage_key');
    });

    it('scopes the task lookup to the caller org', async () => {
      scriptDb({ task: false });

      const res = await request(body, { org: 'org-A' });

      expect(res.statusCode).toBe(404);
      const lookup = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).startsWith('SELECT id FROM tasks'))!;
      expect(lookup[1]).toEqual([T, P, 'org-A']);
      expect(storage.presignUpload).not.toHaveBeenCalled();
      expect(dbSql().some((s) => s.startsWith('INSERT'))).toBe(false);
    });

    it('enforces the per-task attachment limit', async () => {
      scriptDb({ count: 25 });

      const res = await request(body);

      expect(res.statusCode).toBe(409);
      expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    it.each([
      ['a disallowed content type', { ...body, content_type: 'text/html', filename: 'x.html' }],
      ['an extension that does not match the type', { ...body, filename: 'payload.exe' }],
      ['a file over the size limit', { ...body, size: config.ATTACHMENT_MAX_BYTES + 1 }],
      ['a zero size', { ...body, size: 0 }],
      ['a fractional size', { ...body, size: 1.5 }],
      ['a missing field', { filename: 'a.png', content_type: 'image/png' }],
      ['a client-chosen storage key', { ...body, storage_key: 'org/other/tasks/x/y' }],
      ['a client-chosen org', { ...body, org_id: 'org-other' }],
    ])('rejects %s with 400 before any database or storage work', async (_label, payload) => {
      const res = await request(payload);

      expect(res.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
      expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    it('rejects non-uuid path parameters', async () => {
      const res = await inject('POST', `/projects/not-a-uuid/tasks/${T}/attachments`, { payload: body });
      expect(res.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('POST .../complete', () => {
    const complete = (opts: { role?: string; user?: string; org?: string } = {}) =>
      inject('POST', `${base}/${A}/complete`, opts);
    const pending = (over: Record<string, unknown> = {}) => row({ status: 'pending', ...over });

    it('verifies the stored object, marks it ready and records activity', async () => {
      scriptDb({ attachment: pending() });

      const res = await complete();

      expect(res.statusCode).toBe(200);
      expect(storage.head).toHaveBeenCalledWith(KEY);
      expect(storage.readPrefix).toHaveBeenCalledWith(KEY, 16);
      expect(dbSql().some((s) => s.startsWith('UPDATE task_attachments SET status'))).toBe(true);
      const activity = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).startsWith('INSERT INTO activity_log'))!;
      // [org, user, entity_type, entity_id, action, metadata]
      expect(activity[1]!.slice(0, 5)).toEqual(['org-1', 'user-1', 'task', T, 'attachment_added']);
      expect(JSON.parse(activity[1]![5] as string)).toEqual({ attachment_id: A, filename: 'diagram.png' });
      expect(res.body).not.toContain('storage_key');
    });

    it('is idempotent for an already-ready attachment', async () => {
      scriptDb({ attachment: row({ status: 'ready' }) });

      const res = await complete();

      expect(res.statusCode).toBe(200);
      expect(storage.head).not.toHaveBeenCalled();
      expect(dbSql().some((s) => s.startsWith('UPDATE'))).toBe(false);
    });

    it('returns 404 for an unknown attachment, scoping the lookup to the caller org', async () => {
      scriptDb({ attachment: null });

      const res = await complete({ org: 'org-A' });

      expect(res.statusCode).toBe(404);
      const lookup = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).startsWith('SELECT a.id'))!;
      expect(lookup[1]).toEqual([A, T, P, 'org-A']);
      expect(storage.head).not.toHaveBeenCalled();
    });

    it('only the uploader or an admin may complete', async () => {
      scriptDb({ attachment: pending({ uploaded_by: 'someone-else' }) });

      const other = await complete({ role: 'member', user: 'user-1' });
      expect(other.statusCode).toBe(403);
      expect(storage.head).not.toHaveBeenCalled();

      expect((await complete({ role: 'admin', user: 'user-1' })).statusCode).toBe(200);
    });

    it('returns 409 if nothing was uploaded yet, and keeps the pending row', async () => {
      scriptDb({ attachment: pending() });
      storage.head.mockResolvedValue(null);

      const res = await complete();

      expect(res.statusCode).toBe(409);
      expect(dbSql().some((s) => s.startsWith('DELETE'))).toBe(false);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it.each([
      ['size differs from the declared size', { size: 999, contentType: 'image/png' }, PNG_HEAD],
      ['content type differs from the declared type', { size: 123, contentType: 'text/html' }, PNG_HEAD],
      ['bytes do not match the declared type', { size: 123, contentType: 'image/png' }, new TextEncoder().encode('MZ-not-a-png!')],
    ])('rejects and purges an upload whose %s', async (_label, head, prefix) => {
      scriptDb({ attachment: pending() });
      storage.head.mockResolvedValue(head);
      storage.readPrefix.mockResolvedValue(prefix);

      const res = await complete();

      expect(res.statusCode).toBe(422);
      expect(storage.delete).toHaveBeenCalledWith(KEY); // never leave a rejected file in the bucket
      expect(dbSql().some((s) => s.startsWith('DELETE FROM task_attachments'))).toBe(true);
      expect(dbSql().some((s) => s.startsWith('UPDATE'))).toBe(false);
    });

    it('returns 502 and keeps the row when storage is unavailable', async () => {
      scriptDb({ attachment: pending() });
      storage.head.mockRejectedValue(new Error('connection refused'));

      const res = await complete();

      expect(res.statusCode).toBe(502);
      expect(dbSql().some((s) => s.startsWith('DELETE'))).toBe(false);
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET (list)', () => {
    it('returns only ready attachments for the task, scoped by org', async () => {
      scriptDb({ list: [{ id: A, filename: 'diagram.png' }] });

      const res = await inject('GET', base, { org: 'org-9' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: A, filename: 'diagram.png' }]);
      const list = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).includes('ORDER BY'))!;
      expect(sqlOf(list)).toContain("status = 'ready'");
      expect(sqlOf(list)).not.toContain('storage_key');
      expect(list[1]).toEqual([T, 'org-9']);
    });

    it('returns 404 when the task is not in the caller org', async () => {
      scriptDb({ task: false });
      expect((await inject('GET', base)).statusCode).toBe(404);
    });
  });

  describe('GET .../download', () => {
    const download = (opts: { org?: string } = {}) => inject('GET', `${base}/${A}/download`, opts);

    it('returns a short-lived URL for a ready attachment', async () => {
      scriptDb({ attachment: row() });

      const res = await download();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ url: 'http://storage.test/download?sig=2', expires_in: 120 });
      expect(storage.presignDownload).toHaveBeenCalledWith({ key: KEY, filename: 'diagram.png', expiresInSeconds: 120 });
    });

    it('does not serve a pending (unverified) upload', async () => {
      scriptDb({ attachment: row({ status: 'pending' }) });

      expect((await download()).statusCode).toBe(404);
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });

    it('does not serve an attachment from another tenant, task or project', async () => {
      scriptDb({ attachment: null }); // the org/project/task-scoped lookup finds nothing

      const res = await download({ org: 'org-attacker' });

      expect(res.statusCode).toBe(404);
      const lookup = vi.mocked(db.query).mock.calls.find((c) => sqlOf(c).startsWith('SELECT a.id'))!;
      expect(sqlOf(lookup)).toContain('t.project_id = $3');
      expect(sqlOf(lookup)).toContain('a.org_id = $4');
      expect(lookup[1]).toEqual([A, T, P, 'org-attacker']);
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    const del = (opts: { role?: string; user?: string; org?: string } = {}) => inject('DELETE', `${base}/${A}`, opts);

    it('lets the uploader delete: row first, then the object, with activity', async () => {
      scriptDb({ attachment: row() });

      const res = await del();

      expect(res.statusCode).toBe(204);
      expect(storage.delete).toHaveBeenCalledWith(KEY);
      const sqls = dbSql();
      expect(sqls.some((s) => s.startsWith('DELETE FROM task_attachments'))).toBe(true);
      expect(sqls.some((s) => s.startsWith('INSERT INTO activity_log'))).toBe(true);
    });

    it('forbids a different member, but allows an admin', async () => {
      scriptDb({ attachment: row({ uploaded_by: 'someone-else' }) });

      const member = await del({ role: 'member' });
      expect(member.statusCode).toBe(403);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(dbSql().some((s) => s.startsWith('DELETE'))).toBe(false);

      expect((await del({ role: 'admin' })).statusCode).toBe(204);
    });

    it('returns 404 for an unknown or cross-tenant attachment', async () => {
      scriptDb({ attachment: null });
      expect((await del({ org: 'org-A' })).statusCode).toBe(404);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('still succeeds if the object delete fails (the row is gone; the object is an orphan)', async () => {
      scriptDb({ attachment: row() });
      storage.delete.mockRejectedValue(new Error('storage down'));

      const res = await del();

      expect(res.statusCode).toBe(204);
    });

    it('does not log activity when discarding a never-completed upload', async () => {
      scriptDb({ attachment: row({ status: 'pending' }) });

      await del();

      expect(dbSql().some((s) => s.startsWith('INSERT INTO activity_log'))).toBe(false);
    });
  });
});
