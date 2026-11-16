import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { redisOutage } from './fakes';
import { createProject, createTask, registerOrg, startApp, type Actor, type App } from './harness';

/**
 * H.2: with Redis down, the API keeps serving from Postgres. (How the real cache module degrades is
 * unit-tested in cache/redis.fallback.test.ts; here the routes run against that contract.)
 */
describe('Redis outage (real Postgres)', () => {
  let app: App;
  let admin: Actor;
  let project: { id: string };

  beforeAll(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    project = await createProject(app, admin, 'Before the outage');
  });

  afterEach(() => {
    redisOutage.active = false;
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: admin.auth, payload });

  it('serves the project list and task board from the database', async () => {
    const task = await createTask(app, admin, project.id, { title: 'Survives the outage' });
    redisOutage.active = true;

    const projects = await as('GET', '/api/projects');
    expect(projects.statusCode).toBe(200);
    expect(projects.json().map((p: { id: string }) => p.id)).toContain(project.id);

    const board = await as('GET', `/api/projects/${project.id}/tasks`);
    expect(board.statusCode).toBe(200);
    expect(board.json().todo.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it('accepts writes, and reads show them at once', async () => {
    redisOutage.active = true;

    const created = await as('POST', '/api/projects', { name: 'During the outage' });
    expect(created.statusCode).toBe(201);

    const renamed = await as('PATCH', `/api/projects/${project.id}`, { name: 'Renamed during the outage' });
    expect(renamed.statusCode).toBe(200);

    const task = await as('POST', `/api/projects/${project.id}/tasks`, { title: 'Created during the outage' });
    expect(task.statusCode).toBe(201);

    const names = (await as('GET', '/api/projects')).json().map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(['During the outage', 'Renamed during the outage']));

    const board = (await as('GET', `/api/projects/${project.id}/tasks`)).json();
    expect(board.todo.map((t: { id: string }) => t.id)).toContain(task.json().id);
  });

  it('stays ready: /health is 200 "degraded", liveness is unaffected', async () => {
    redisOutage.active = true;

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'degraded', db: 'ok', redis: 'error' });

    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
  });

  it('reports ok again once Redis is back', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({ status: 'ok', redis: 'ok' });
  });
});
