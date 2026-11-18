import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

vi.mock('bcrypt', () => {
  const api = { hash: async (pw: string) => `hashed:${pw}`, compare: async () => true };
  return { default: api, ...api };
});
vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

import { db } from '../db/client';
import { TRUST_TOKEN_CLAIMS } from '../test/auth';
import authPlugin from '../plugins/auth';
import profileRoutes from './profile';

const sqlOf = (c: readonly unknown[] | undefined) => String(c?.[0]);
type Cookie = { name: string; value: string; httpOnly?: boolean };

describe('Profile routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Same Ajv options as production (src/app.ts): unknown keys are NOT stripped.
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await app.register(cookie);
    await app.register(authPlugin, TRUST_TOKEN_CLAIMS);
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
    it('updates the name, filtering by the authenticated user id and organization', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer' }]);

      const res = await patch({ name: 'Ada' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'user-1', name: 'Ada' });
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe('UPDATE users SET name = $1 WHERE id = $2 AND org_id = $3 RETURNING id, name, email, role, org_id, token_version');
      expect(call![1]).toEqual(['Ada', 'user-1', 'org-1']);
    });

    it('stores a hashed password in password_hash and never the plaintext', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer', org_id: 'org-1', token_version: 3 }]);

      const res = await patch({ password: 'newpassword1' });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe(
        'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 AND org_id = $3 RETURNING id, name, email, role, org_id, token_version'
      );
      expect(call![1]).toEqual(['hashed:newpassword1', 'user-1', 'org-1']);
      expect(JSON.stringify(res.json())).not.toMatch(/password/);
    });

    it('updates name and password together with correct parameter order', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', org_id: 'org-1', role: 'viewer', token_version: 1 }]);

      const res = await patch({ name: 'Ada', password: 'newpassword1' });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.query).mock.calls[0];
      expect(sqlOf(call)).toBe(
        'UPDATE users SET name = $1, password_hash = $2, token_version = token_version + 1 WHERE id = $3 AND org_id = $4 RETURNING id, name, email, role, org_id, token_version'
      );
      expect(call![1]).toEqual(['Ada', 'hashed:newpassword1', 'user-1', 'org-1']);
    });

    it('returns 404 when the user no longer exists', async () => {
      vi.mocked(db.query).mockResolvedValue([]);
      const res = await patch({ name: 'Ada' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /me — sessions', () => {
    it('re-issues the caller session with the new token version after a password change', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer', org_id: 'org-1', token_version: 4 }]);

      const res = await patch({ password: 'newpassword1' });

      const cookie = (res.cookies as Cookie[]).find((c) => c.name === 'auth_token');
      expect(cookie?.httpOnly).toBe(true);
      expect(app.jwt.decode(cookie!.value) as unknown).toMatchObject({ user_id: 'user-1', tv: 4 });
      // Internal columns are not part of the response.
      expect(res.json()).toEqual({ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer' });
    });

    it('leaves the session alone when only the name changes', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada', email: 'a@b.com', role: 'viewer' }]);

      const res = await patch({ name: 'Ada' });

      expect((res.cookies as Cookie[]).find((c) => c.name === 'auth_token')).toBeUndefined();
    });
  });

  describe('GET /me', () => {
    it('returns the caller profile scoped to their own id and organization', async () => {
      vi.mocked(db.query).mockResolvedValue([{ id: 'user-1', name: 'Ada' }]);

      const res = await app.inject({ method: 'GET', url: '/profile/me', headers: headers() });

      expect(res.statusCode).toBe(200);
      expect(String(vi.mocked(db.query).mock.calls[0]![0])).toContain('AND org_id = $2');
      expect(vi.mocked(db.query).mock.calls[0]![1]).toEqual(['user-1', 'org-1']);
    });
  });
});
