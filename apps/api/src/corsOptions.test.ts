import { describe, it, expect } from 'vitest';
import fastify from 'fastify';
import cors from '@fastify/cors';
import { corsOptions } from './corsOptions';

const ORIGIN = 'http://localhost:3001';

async function preflight(method: string, origin = ORIGIN) {
  const app = fastify();
  await app.register(cors, corsOptions(ORIGIN));
  return app.inject({
    method: 'OPTIONS',
    url: '/api/projects/p1/tasks/t1',
    headers: { origin, 'access-control-request-method': method },
  });
}

describe('CORS preflight', () => {
  // A regression here is invisible to the API tests and to curl: only a browser enforces it, and
  // the symptom is that every PATCH/DELETE from the web app fails ("blocked by CORS policy").
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('allows %s from the web origin', async (method) => {
    const res = await preflight(method);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const allowed = String(res.headers['access-control-allow-methods']).split(',').map((m) => m.trim());
    expect(allowed).toContain(method);
  });

  it('never echoes back another origin', async () => {
    // With a fixed origin the header always names the configured one, so a browser on any other
    // origin sees a mismatch and blocks the request.
    const res = await preflight('PATCH', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});
