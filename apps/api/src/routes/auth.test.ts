import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcrypt';

// Hashing is not under test here; a deterministic fake keeps tests fast and
// independent of the native bcrypt binary.
vi.mock('bcrypt', () => {
  const api = {
    hash: async (pw: string) => `hashed:${pw}`,
    compare: async (pw: string, hash: string) => hash === `hashed:${pw}`,
  };
  return { default: api, ...api };
});

vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

import { db } from '../db/client';
import authPlugin from '../plugins/auth';
import { authFailuresTotal } from '../metrics';
import authRoutes from './auth';

const mockClient = { query: vi.fn(), release: vi.fn() };
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const sqlOf = (c: readonly unknown[] | undefined) => String(c?.[0]);

describe('Auth routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
    vi.mocked(db.getClient).mockResolvedValue(mockClient as never);
  });

  afterEach(async () => {
    await app.close();
  });

  const validRegister = {
    org_name: 'Acme',
    org_slug: 'acme',
    email: 'Admin@Acme.com',
    password: 'password123',
    name: 'Ada',
  };

  describe('register', () => {
    it('creates org and admin user in one transaction and sets an httpOnly cookie', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('INSERT INTO organizations')) return rows([{ id: 'org-1' }]);
        if (sql.startsWith('INSERT INTO users')) return rows([{ id: 'user-1' }]);
        return rows();
      });

      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validRegister });

      expect(res.statusCode).toBe(201);
      expect(app.jwt.verify(res.json().token)).toMatchObject({
        user_id: 'user-1',
        org_id: 'org-1',
        role: 'admin',
      });
      expect(String(res.headers['set-cookie'])).toMatch(/auth_token=.*HttpOnly/i);

      const sqls = mockClient.query.mock.calls.map(sqlOf);
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls).toContain('COMMIT');

      const userInsert = mockClient.query.mock.calls.find((c) => sqlOf(c).startsWith('INSERT INTO users'));
      expect(userInsert![1][1]).toBe('admin@acme.com'); // email normalised
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns 409 and rolls back when the slug is taken', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM organizations') ? rows([{ id: 'x' }]) : rows()
      );

      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validRegister });

      expect(res.statusCode).toBe(409);
      expect(mockClient.query.mock.calls.map(sqlOf)).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns 409 when the email is already registered', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM users') ? rows([{ id: 'x' }]) : rows()
      );

      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validRegister });

      expect(res.statusCode).toBe(409);
    });

    it('rejects invalid payloads without touching the database', async () => {
      const bad = [
        { ...validRegister, password: 'short' },
        { ...validRegister, org_slug: 'Bad Slug!' },
        { ...validRegister, email: 'not-an-email' },
        { org_name: 'x' },
      ];
      for (const payload of bad) {
        const res = await app.inject({ method: 'POST', url: '/auth/register', payload });
        expect(res.statusCode).toBe(400);
      }
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a token for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 4);
      vi.mocked(db.query).mockResolvedValue([
        { id: 'u1', org_id: 'o1', role: 'member', password_hash: hash },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'A@B.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(200);
      expect(app.jwt.verify(res.json().token)).toMatchObject({
        user_id: 'u1',
        org_id: 'o1',
        role: 'member',
      });
      expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual(['a@b.com']);
    });

    it('returns the same 401 for a wrong password and an unknown user', async () => {
      const hash = await bcrypt.hash('password123', 4);
      vi.mocked(db.query).mockResolvedValueOnce([
        { id: 'u1', org_id: 'o1', role: 'member', password_hash: hash },
      ]);
      const wrongPw = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'a@b.com', password: 'nope' },
      });

      vi.mocked(db.query).mockResolvedValueOnce([]);
      const unknown = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'x@b.com', password: 'nope' },
      });

      expect(wrongPw.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrongPw.json()).toEqual(unknown.json());
    });
  });

  describe('login failure metrics', () => {
    const attempt = (email: string, password: string) =>
      app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    const failures = async () =>
      (await authFailuresTotal.get()).values.find((v) => v.labels.reason === 'bad_credentials')?.value ?? 0;

    beforeEach(() => authFailuresTotal.reset());

    it('counts a wrong password and an unknown user under the same reason (no enumeration signal)', async () => {
      const hash = await bcrypt.hash('password123', 4);
      vi.mocked(db.query).mockResolvedValueOnce([{ id: 'u1', org_id: 'o1', role: 'member', password_hash: hash }]);
      await attempt('known@b.com', 'wrong-password');

      vi.mocked(db.query).mockResolvedValueOnce([]);
      await attempt('nobody@b.com', 'whatever123');

      expect(await failures()).toBe(2);
    });

    it('does not count a successful login', async () => {
      const hash = await bcrypt.hash('password123', 4);
      vi.mocked(db.query).mockResolvedValueOnce([{ id: 'u1', org_id: 'o1', role: 'member', password_hash: hash }]);

      const res = await attempt('known@b.com', 'password123');

      expect(res.statusCode).toBe(200);
      expect(await failures()).toBe(0);
    });

    it('does not put the email address in any metric label', async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      await attempt('private.person@example.org', 'whatever123');

      expect(JSON.stringify((await authFailuresTotal.get()).values)).not.toContain('private.person');
    });
  });

  describe('session', () => {
    it('/me returns the JWT identity and rejects a missing token', async () => {
      const token = app.jwt.sign({ user_id: 'u1', org_id: 'o1', role: 'viewer' });
      const ok = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().user).toMatchObject({ user_id: 'u1', org_id: 'o1', role: 'viewer' });

      const anon = await app.inject({ method: 'GET', url: '/auth/me' });
      expect(anon.statusCode).toBe(401);
    });

    it('logout clears the cookie', async () => {
      const res = await app.inject({ method: 'POST', url: '/auth/logout' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['set-cookie'])).toMatch(/auth_token=;/);
    });
  });

  describe('password reset', () => {
    it('forgot-password responds identically for known and unknown emails', async () => {
      vi.mocked(db.query).mockResolvedValueOnce([{ id: 'u1' }]).mockResolvedValueOnce([]);
      const known = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'a@b.com' },
      });
      expect(sqlOf(vi.mocked(db.query).mock.calls[1])).toMatch(/INSERT INTO password_reset_tokens/);

      vi.mocked(db.query).mockResolvedValueOnce([]);
      const unknown = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'z@b.com' },
      });

      expect(known.statusCode).toBe(200);
      expect(known.json()).toEqual(unknown.json());
      const inserts = vi.mocked(db.query).mock.calls.filter((c) => /INSERT/.test(sqlOf(c)));
      expect(inserts).toHaveLength(1); // none for the unknown email
    });

    it('reset-password updates the hash and deletes tokens for a valid token', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM password_reset_tokens')
          ? rows([{ user_id: 'u1', expires_at: new Date(Date.now() + 60_000) }])
          : rows()
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 't', password: 'newpassword1' },
      });

      expect(res.statusCode).toBe(200);
      const sqls = mockClient.query.mock.calls.map(sqlOf);
      expect(sqls.some((s) => s.startsWith('UPDATE users SET password_hash'))).toBe(true);
      expect(sqls.some((s) => s.startsWith('DELETE FROM password_reset_tokens'))).toBe(true);
      expect(sqls).toContain('COMMIT');
    });

    it('rejects unknown and expired tokens with 400', async () => {
      mockClient.query.mockImplementation(async () => rows());
      const unknown = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'bad', password: 'newpassword1' },
      });
      expect(unknown.statusCode).toBe(400);

      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM password_reset_tokens')
          ? rows([{ user_id: 'u1', expires_at: new Date(Date.now() - 1000) }])
          : rows()
      );
      const expired = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'old', password: 'newpassword1' },
      });
      expect(expired.statusCode).toBe(400);
      expect(mockClient.query.mock.calls.map(sqlOf)).toContain('ROLLBACK');
    });

    it('rejects short new passwords before touching the database', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 't', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });
});
