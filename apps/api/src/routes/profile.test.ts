import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('bcrypt', () => {
  const api = { hash: async (pw: string) => `hashed:${pw}`, compare: async () => true };
  return { default: api, ...api };
});
vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

import { db } from '../db/client';
import authPlugin from '../plugins/auth';
import profileRoutes from './profile';

const sqlOf = (c: readonly unknown[] | undefined) => String(c?.[0]);

describe('Profile routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Same Ajv options as production (src/index.ts): unknown keys are NOT stripped.
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await app.register(authPlugin);
    await app.register(profileRoutes, { prefix: '/profile' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = (role = 'viewer') => ({
    authorization: `Bearer ${app.jwt.sign({ user_id: 'user-1', org_id: 'org-1', role })}`,
  });
  const patch = (payload: Record<string, unknown>, role?: string) =>
    app.inject({ method: 'PATCH', url: '/profile/me', headers: headers(role), payload });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/profile/me', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  describe('PATCH /me — unknown / protected fields', () => {
    it.each([
      ['role (privilege escalation)', { role: 'owner' }],
      ['org_id (cross-tenant move)', { org_id: 'org-other' }],
      ['email', { email: 'attacker@example.com' }],
      ['id', { id: 'someone-else' }],
      ['password_hash', { password_hash: 'x' }],
      ['a SQL-injection key', { name: 'ok', "role = 'owner', name": 'x' }],
      ['a valid field mixed with a protected one', { name: 'ok', role: 'owner' }],
    ])('rejects %s with 400 before touching the database', async (_label, payload) => {
      const res = await patch(payload);

      expect(res.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      const res = await patch({});
      expect(res.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /me — valid updates', () => {
    it('updates the name, filtering by the authenticated user id', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer' }]);

      const res = await patch({ name: 'Ada' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'user-1', name: 'Ada' });
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe('UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, role');
      expect(call![1]).toEqual(['Ada', 'user-1']);
    });

    it('stores a hashed password in password_hash and never the plaintext', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer' }]);

      const res = await patch({ password: 'newpassword1' });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe('UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, name, email, role');
      expect(call![1]).toEqual(['hashed:newpassword1', 'user-1']);
      expect(JSON.stringify(res.json())).not.toMatch(/password/);
    });

    it('updates name and password together with correct parameter order', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1' }]);

      const res = await patch({ name: 'Ada', password: 'newpassword1' });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe(
        'UPDATE users SET name = $1, password_hash = $2 WHERE id = $3 RETURNING id, name, email, role'
      );
      expect(call![1]).toEqual(['Ada', 'hashed:newpassword1', 'user-1']);
    });

    it('returns 404 when the user no longer exists', async () => {
      vi.mocked(db.query).mockResolvedValue([]);
      const res = await patch({ name: 'Ada' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /me', () => {
    it('returns the caller profile scoped to their own id', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada' }]);

      const res = await app.inject({ method: 'GET', url: '/profile/me', headers: headers() });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(db.query).mock.calls[0]![1]).toEqual(['user-1']);
    });
  });
});
