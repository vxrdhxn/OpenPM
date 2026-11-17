import { describe, expect, it, vi } from 'vitest';

vi.mock('../cache/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), ping: vi.fn(), subscribe: vi.fn() },
}));

import { buildApp } from '../app';

/**
 * Private projects are enforced for nested routes by ONE gate in app.ts: it reads the project from
 * the `:projectId` (or, for /api/projects/:id, `:id`) parameter. A route under /api/projects that
 * named its project parameter differently would skip the gate and serve a private project to
 * anyone in the organization. This fails if one is ever added.
 */
describe('project access gate coverage', () => {
  it('every route under /api/projects/ takes the project as :projectId or :id, first', async () => {
    const app = buildApp({ logger: false });
    const urls: string[] = [];
    app.addHook('onRoute', (route) => {
      urls.push(route.url);
    });
    await app.ready();
    await app.close();

    // The collection itself (list, create) has no project to check.
    const nested = [...new Set(urls)].filter((u) => u.startsWith('/api/projects/') && u !== '/api/projects/');
    expect(nested.length).toBeGreaterThan(10);
    const ungated = nested.filter((u) => !/^\/api\/projects\/:(projectId|id)(\/|$)/.test(u));
    expect(ungated).toEqual([]);
  }, 20_000); // builds the whole app, which is slow when the suite runs in parallel
});
