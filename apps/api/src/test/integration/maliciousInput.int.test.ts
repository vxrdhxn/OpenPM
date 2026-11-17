import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { createProject, createTask, registerOrg, startApp, type Actor, type App } from './harness';

/**
 * Hostile input against the real app and Postgres: nothing may crash a handler (a 500), change data
 * it was not meant to, or come back unescaped. Each case is a 4xx, or stored as plain text.
 */
describe('malicious payloads (real Postgres)', () => {
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

  const send = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...admin.auth, ...headers }, payload: payload as never });

  it('stores SQL and HTML as plain text, and leaves the tables alone', async () => {
    const evil = `'); DROP TABLE tasks; -- <script>alert(1)</script> " OR 1=1 --`;
    const res = await send('POST', `/api/projects/${project.id}/tasks`, { title: evil, description: evil });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe(evil);
    expect((await db.query('SELECT count(*)::int AS n FROM tasks WHERE project_id = $1', [project.id]))[0].n).toBe(2);

    const search = await send('GET', `/api/tasks?q=${encodeURIComponent("%' OR '1'='1")}`);
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toEqual([]);
  });

  it.each([
    ['a task title', 'POST', () => `/api/projects/${project.id}/tasks`, (v: string) => ({ title: v })],
    ['a comment', 'POST', () => `/api/projects/${project.id}/tasks/${task.id}/comments`, (v: string) => ({ body: v })],
    ['a project name', 'PATCH', () => `/api/projects/${project.id}`, (v: string) => ({ name: v })],
    ['a search', 'GET', () => `/api/tasks?q=${encodeURIComponent('a\u0000b')}`, () => undefined],
  ] as const)('a NUL byte in %s is a 400, not a database error', async (_what, method, url, body) => {
    const res = await send(method, url(), body('bad\u0000title'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid request/);
  });

  it('ignores __proto__ and constructor keys: no pollution, no extra columns', async () => {
    const raw = `{"title":"Proto","__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":true}}}`;
    const res = await send('POST', `/api/projects/${project.id}/tasks`, raw, { 'content-type': 'application/json' });
    expect([201, 400]).toContain(res.statusCode);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses unknown fields that would set ownership or organization', async () => {
    const other = await registerOrg(app);
    const res = await send('PATCH', `/api/projects/${project.id}/tasks/${task.id}`, { title: 'x', org_id: other.orgId });
    expect(res.statusCode).toBe(400);
    const res2 = await send('PATCH', '/api/profile/me', { name: 'Root', role: 'owner', org_id: other.orgId });
    expect(res2.statusCode).toBe(400);
  });

  it('answers wrong types, deep nesting and malformed JSON with a 400', async () => {
    const url = `/api/projects/${project.id}/tasks`;
    expect((await send('POST', url, { title: { $gt: '' } })).statusCode).toBe(400);
    expect((await send('POST', url, { title: ['a', 'b'] })).statusCode).toBe(400);
    let deep = '"x"';
    for (let i = 0; i < 5000; i++) deep = `{"a":${deep}}`;
    expect((await send('POST', url, `{"title":${deep}}`, { 'content-type': 'application/json' })).statusCode).toBe(400);
    expect((await send('POST', url, '{"title": "unterminated', { 'content-type': 'application/json' })).statusCode).toBe(400);
  });

  it('refuses a body over 1 MB, and an oversized title', async () => {
    const url = `/api/projects/${project.id}/tasks`;
    expect((await send('POST', url, { title: 'x', description: 'y'.repeat(1_100_000) })).statusCode).toBe(413);
    expect((await send('POST', url, { title: 'x'.repeat(10_000) })).statusCode).toBe(400);
  });

  it('keeps unicode, emoji and right-to-left text intact', async () => {
    const title = 'Ünïcødé 🚀 مرحبا ‮gnp.exe';
    const res = await send('POST', `/api/projects/${project.id}/tasks`, { title });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe(title);
  });

  it('never answers a crafted request with a 500', async () => {
    const urls = [
      '/api/tasks?limit=-1',
      '/api/tasks?limit=99999999999999999999',
      '/api/tasks?cursor=%00%00',
      '/api/tasks?cursor=' + 'A'.repeat(600),
      '/api/activity?project_id=%27%3B--',
      `/api/projects/${project.id}/tasks?status=done%27--`,
      '/api/audit?action[]=auth.login',
    ];
    for (const url of urls) {
      const res = await send('GET', url);
      expect(res.statusCode, url).toBeLessThan(500);
    }
  });
});
