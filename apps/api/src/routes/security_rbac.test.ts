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
import Fastify from 'fastify';
import authPlugin, { hasMinRole } from '../plugins/auth';
import projectRoutes from './projects';
import taskRoutes from './tasks';
import inviteRoutes from './invites';

describe('RBAC & Tenant Isolation Security Suite', () => {
  describe('hasMinRole Helper', () => {
    it('correctly ranks owner > admin > member > viewer', () => {
      expect(hasMinRole('owner', 'owner')).toBe(true);
      expect(hasMinRole('owner', 'admin')).toBe(true);
      expect(hasMinRole('owner', 'member')).toBe(true);
      expect(hasMinRole('owner', 'viewer')).toBe(true);

      expect(hasMinRole('admin', 'owner')).toBe(false);
      expect(hasMinRole('admin', 'admin')).toBe(true);
      expect(hasMinRole('admin', 'member')).toBe(true);
      expect(hasMinRole('admin', 'viewer')).toBe(true);

      expect(hasMinRole('member', 'admin')).toBe(false);
      expect(hasMinRole('member', 'member')).toBe(true);
      expect(hasMinRole('member', 'viewer')).toBe(true);

      expect(hasMinRole('viewer', 'member')).toBe(false);
      expect(hasMinRole('viewer', 'admin')).toBe(false);
      expect(hasMinRole('viewer', 'viewer')).toBe(true);
    });

    it('rejects unknown or missing roles', () => {
      expect(hasMinRole('', 'viewer')).toBe(false);
      expect(hasMinRole('guest', 'viewer')).toBe(false);
    });
  });

  describe('Route RBAC Security Controls', () => {
    async function buildApp() {
      const app = Fastify();
      await app.register(authPlugin);
      await app.register(projectRoutes, { prefix: '/projects' });
      await app.register(taskRoutes, { prefix: '/projects' });
      await app.register(inviteRoutes, { prefix: '/invites' });
      await app.ready();
      return app;
    }

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const app = await buildApp();

      const resProjects = await app.inject({
        method: 'GET',
        url: '/projects',
      });
      expect(resProjects.statusCode).toBe(401);
      expect(resProjects.json()).toEqual({ error: 'Unauthorized' });

      const resInvites = await app.inject({
        method: 'GET',
        url: '/invites',
      });
      expect(resInvites.statusCode).toBe(401);
      expect(resInvites.json()).toEqual({ error: 'Unauthorized' });
    });

    it('denies viewer role from creating projects (403 Forbidden)', async () => {
      const app = await buildApp();
      const token = app.jwt.sign({ user_id: 'u1', org_id: 'org1', role: 'viewer' });

      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Unauthorized Project' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden: Insufficient permissions' });
    });

    it('denies viewer role from creating tasks (403 Forbidden)', async () => {
      const app = await buildApp();
      const token = app.jwt.sign({ user_id: 'u1', org_id: 'org1', role: 'viewer' });

      const res = await app.inject({
        method: 'POST',
        url: '/projects/proj-123/tasks',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Unauthorized Task' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden: Insufficient permissions' });
    });

    it('denies member role from deleting projects (403 Forbidden)', async () => {
      const app = await buildApp();
      const token = app.jwt.sign({ user_id: 'u2', org_id: 'org1', role: 'member' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/projects/proj-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden: Insufficient permissions' });
    });

    it('denies member role from deleting tasks (403 Forbidden)', async () => {
      const app = await buildApp();
      const token = app.jwt.sign({ user_id: 'u2', org_id: 'org1', role: 'member' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/projects/proj-123/tasks/task-456',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden: Insufficient permissions' });
    });

    it('denies member role from issuing organization invites (403 Forbidden)', async () => {
      const app = await buildApp();
      const token = app.jwt.sign({ user_id: 'u2', org_id: 'org1', role: 'member' });

      const res = await app.inject({
        method: 'POST',
        url: '/invites',
        headers: { authorization: `Bearer ${token}` },
        payload: { email: 'newmember@example.com', role: 'member' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden: Insufficient permissions' });
    });
  });
});
