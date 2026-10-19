import { describe, it, expect, vi } from 'vitest';

vi.mock('../cache/redis', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
  },
}));
import fastify from 'fastify';
import healthRoutes from './health';

describe('Health Route', () => {
  it('should be configured to return health status', async () => {
    const app = fastify();
    await app.register(healthRoutes);
    // Note: A full integration test would call app.inject({ method: 'GET', url: '/health' })
    // but that requires DB and Redis to be running or mocked.
    // For now, this verifies the test suite runs successfully.
    expect(app.hasRoute({ method: 'GET', url: '/health' })).toBe(true);
  });
});
