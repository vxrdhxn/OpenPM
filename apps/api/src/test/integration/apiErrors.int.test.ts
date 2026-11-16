import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, registerOrg, startApp, type Actor, type App } from './harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

/** H.1: every error has the shape `{ error }`, malformed ids are a 400 (not a Postgres 500). */
describe('API errors (real app wiring)', () => {
  let app: App;
  let admin: Actor;
  let project: { id: string };

  beforeAll(async () => {
    app = await startApp();
    admin = await registerOrg(app);
    project = await createProject(app, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: admin.auth, payload });

  it.each([
    ['GET', '/api/projects/not-a-uuid'],
    ['PATCH', '/api/projects/123'],
    ['DELETE', '/api/projects/abc'],
    ['GET', '/api/projects/not-a-uuid/tasks'],
    ['GET', `/api/projects/{project}/tasks/not-a-uuid/attachments`],
  ] as const)('%s %s with a malformed id is a 400, not a 500', async (method, template) => {
    const url = template.replace('{project}', project.id);
    const res = await as(method, url, method === 'PATCH' ? { name: 'x' } : undefined);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.stringMatching(/^Invalid request: params\/\w+ must match format "uuid"/) });
  });

  it('still returns 404 for a well-formed id that does not exist', async () => {
    const res = await as('GET', `/api/projects/${UNKNOWN}`);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Project not found' });
  });

  it('checks authentication before validating the id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/not-a-uuid' });

    expect(res.statusCode).toBe(401);
  });

  it('answers validation failures as { error }', async () => {
    const res = await as('POST', '/api/projects', { name: '' });

    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json())).toEqual(['error']);
    expect(res.json().error).toMatch(/^Invalid request: body\/name/);
  });

  it('answers unknown routes as { error }', async () => {
    const res = await as('GET', '/api/does-not-exist');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });
});
