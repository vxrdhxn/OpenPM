import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import errorHandling from './errors';
import uuidParams, { isIdParam, pathParams } from './uuidParams';

const ID = '3f1c2b9e-6a4d-4c1e-9b7a-2d5e8f0a1b2c';

describe('error handling and id validation', () => {
  let app: FastifyInstance;
  let thrown: Error = new Error('unset');

  async function build() {
    app = Fastify({ logger: false });
    await app.register(errorHandling);
    await app.register(uuidParams);

    app.get('/boom', async () => {
      throw new Error('query failed on 10.0.0.5 with password=hunter2');
    });
    app.get('/db-down', async () => {
      throw thrown;
    });
    app.get('/busy', async () => {
      throw new Error('timeout exceeded when trying to connect');
    });
    app.get('/teapot', async () => {
      throw Object.assign(new Error('I am a teapot'), { statusCode: 418 });
    });
    app.post('/strict', { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } }, async () => ({ ok: true }));
    app.register(
      async (child) => {
        child.get('/:projectId/tasks/:taskId', async (request) => request.params);
        child.get('/by-slug/:slug', async (request) => request.params);
      },
      { prefix: '/projects' }
    );
    await app.ready();
    return app;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('hides the message of an unhandled error', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error' });
    expect(res.body).not.toContain('hunter2');
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('answers database pool exhaustion as 503 with Retry-After (overload, not a bug)', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/busy' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.json()).toEqual({ error: 'The server is busy. Please try again.' });
  });

  it.each([
    ['refused', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' })],
    ['terminated', new Error('Connection terminated due to connection timeout')],
    ['admin shutdown', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })],
    ['connection exception', Object.assign(new Error('connection failure'), { code: '08006' })],
  ])('answers an unreachable database (%s) as 503 with Retry-After', async (_label, error) => {
    thrown = error;
    const res = await (await build()).inject({ method: 'GET', url: '/db-down' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).not.toContain('10.0.0.5');
  });

  it('still answers an ordinary query error as a plain 500', async () => {
    thrown = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const res = await (await build()).inject({ method: 'GET', url: '/db-down' });

    expect(res.statusCode).toBe(500);
  });

  it('passes through the message of a 4xx error', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/teapot' });

    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: 'I am a teapot' });
  });

  it('answers validation errors with the same shape', async () => {
    const res = await (await build()).inject({ method: 'POST', url: '/strict', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid request: body must have required property 'name'" });
  });

  it('answers an unknown route with the same shape', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('answers a malformed JSON body with the same shape', async () => {
    const res = await (await build()).inject({
      method: 'POST',
      url: '/strict',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });

    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json())).toEqual(['error']);
  });

  it('rejects ids that are not UUIDs, in nested plugins too', async () => {
    const res = await (await build()).inject({ method: 'GET', url: `/projects/${ID}/tasks/not-a-uuid` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/^Invalid request: params\/taskId must match format "uuid"/);
  });

  it('rejects SQL in an id before any handler runs', async () => {
    const res = await (await build()).inject({ method: 'GET', url: `/projects/${encodeURIComponent("1' OR '1'='1")}/tasks/${ID}` });

    expect(res.statusCode).toBe(400);
  });

  it('accepts UUIDs, and leaves non-id params alone', async () => {
    await build();

    const ok = await app.inject({ method: 'GET', url: `/projects/${ID}/tasks/${ID}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ projectId: ID, taskId: ID });

    const slug = await app.inject({ method: 'GET', url: '/projects/by-slug/my-project' });
    expect(slug.statusCode).toBe(200);
  });
});

describe('id param detection', () => {
  it('finds path params', () => {
    expect(pathParams('/:projectId/tasks/:taskId/attachments/:attachmentId/complete')).toEqual(['projectId', 'taskId', 'attachmentId']);
    expect(pathParams('/health')).toEqual([]);
  });

  it('treats id and *Id as ids', () => {
    expect(isIdParam('id')).toBe(true);
    expect(isIdParam('projectId')).toBe(true);
    expect(isIdParam('slug')).toBe(false);
    expect(isIdParam('identity')).toBe(false);
    expect(isIdParam('Id')).toBe(false);
  });
});
