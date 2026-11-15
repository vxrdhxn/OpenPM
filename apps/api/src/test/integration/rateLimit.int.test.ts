import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type App } from './harness';

// Its own file (and app): the rate-limit counters are per app instance.
describe('rate limiting (real app wiring)', () => {
  let app: App;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('limits login attempts to 10 per minute per client', async () => {
    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'x' } });

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt()).statusCode);

    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('limits forgot-password to 5 per minute per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nobody@example.com' } })).statusCode);
    }

    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
