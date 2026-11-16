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

const { queueAdd } = vi.hoisted(() => ({ queueAdd: vi.fn() }));
vi.mock('../queue', () => ({ getJobQueue: () => ({ add: queueAdd }) }));

import { db } from '../db/client';
import { hashToken } from '../security/tokens';
import { TRUST_TOKEN_CLAIMS } from '../test/auth';
import authPlugin from '../plugins/auth';
import { authFailuresTotal } from '../metrics';
import authRoutes, { REGISTER_CONFLICT } from './auth';

const mockClient = { query: vi.fn(), release: vi.fn() };
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const sqlOf = (c: readonly unknown[] | undefined) => String(c?.[0]);

describe('Auth routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin, TRUST_TOKEN_CLAIMS);
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
        tv: 0,
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
      expect(res.json()).toEqual({ error: REGISTER_CONFLICT });
      expect(mockClient.query.mock.calls.map(sqlOf)).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns 409 when the email is already registered', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM users') ? rows([{ id: 'x' }]) : rows()
      );

      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validRegister });

      // Same answer as a taken slug: the response does not reveal that the email is registered.
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: REGISTER_CONFLICT });
      expect(res.body).not.toMatch(/email/i);
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
        { id: 'u1', org_id: 'o1', role: 'member', password_hash: hash, token_version: 7 },
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
        tv: 7, // the user's current token version, or the session would be rejected as revoked
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

    it('logout clears the cookie, even when signed out, without touching the database', async () => {
      const res = await app.inject({ method: 'POST', url: '/auth/logout' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['set-cookie'])).toMatch(/auth_token=;/);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('logout by a signed-in user ends all of their sessions (bumps token_version)', async () => {
      vi.mocked(db.query).mockResolvedValue([{ token_version: 1 }]);
      const token = app.jwt.sign({ user_id: 'u1', org_id: 'o1', role: 'viewer', tv: 0 });

      const res = await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${token}` } });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.query).mock.calls[0]!;
      expect(sqlOf(call)).toMatch(/^UPDATE users SET token_version = token_version \+ 1 WHERE id = \$1/);
      expect(call[1]).toEqual(['u1']);
    });
  });

  describe('password reset', () => {
    const TOKEN = 'c'.repeat(64);
    const forgot = (email: string) =>
      app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email } });
    const reset = (payload: object) => app.inject({ method: 'POST', url: '/auth/reset-password', payload });

    it('forgot-password stores a token hash, invalidates older links and emails the raw token via a job', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT id FROM users') ? rows([{ id: 'u1' }]) : rows()
      );

      const res = await forgot('Ada@Example.com');
      expect(res.statusCode).toBe(200);
      await vi.waitFor(() => expect(queueAdd).toHaveBeenCalledTimes(1));

      const calls = mockClient.query.mock.calls;
      expect(calls.find((c) => sqlOf(c).startsWith('SELECT id FROM users'))![1]).toEqual(['ada@example.com']);
      expect(calls.map(sqlOf)).toContain('DELETE FROM password_reset_tokens WHERE user_id = $1');
      const insert = calls.find((c) => sqlOf(c).startsWith('INSERT INTO password_reset_tokens'))!;
      expect(sqlOf(insert)).toContain('token_hash');

      const [jobName, data, opts] = queueAdd.mock.calls[0]!;
      expect(jobName).toBe('password_reset_requested');
      expect(data).toMatchObject({ user_id: 'u1' });
      expect(data.token).toMatch(/^[0-9a-f]{64}$/);
      // The database gets the hash of exactly the token that is emailed, never the token itself.
      expect((insert[1] as unknown[])[1]).toBe(hashToken(data.token));
      expect(insert[1]).not.toContain(data.token);
      expect(opts).toMatchObject({ removeOnComplete: true });
    });

    it('forgot-password answers identically for unknown emails and queues nothing', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT id FROM users') ? rows([{ id: 'u1' }]) : rows()
      );
      const known = await forgot('a@b.com');
      await vi.waitFor(() => expect(queueAdd).toHaveBeenCalledTimes(1));

      mockClient.query.mockImplementation(async () => rows());
      const unknown = await forgot('z@b.com');
      await vi.waitFor(() => expect(mockClient.query.mock.calls.map(sqlOf).filter((s) => s === 'COMMIT')).toHaveLength(2));

      expect(known.statusCode).toBe(200);
      expect(unknown.json()).toEqual(known.json());
      expect(queueAdd).toHaveBeenCalledTimes(1);
    });

    it('forgot-password replies before doing any work, so timing does not reveal registered emails', async () => {
      let release!: () => void;
      vi.mocked(db.getClient).mockReturnValue(new Promise((r) => (release = () => r(mockClient as never))) as never);
      mockClient.query.mockImplementation(async () => rows());

      const res = await forgot('slow@b.com');

      expect(res.statusCode).toBe(200); // answered while the lookup is still pending
      release();
    });

    it('forgot-password still answers 200 when issuing the link fails', async () => {
      vi.mocked(db.getClient).mockRejectedValue(new Error('db down'));

      const res = await forgot('a@b.com');

      expect(res.statusCode).toBe(200);
    });

    it('reset-password looks up the token hash, updates the password, consumes tokens and records it', async () => {
      mockClient.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM password_reset_tokens t') ? rows([{ user_id: 'u1', org_id: 'o1' }]) : rows()
      );

      const res = await reset({ token: TOKEN, password: 'newpassword1' });

      expect(res.statusCode).toBe(200);
      const calls = mockClient.query.mock.calls;
      const lookup = calls.find((c) => sqlOf(c).includes('FROM password_reset_tokens t'))!;
      expect(sqlOf(lookup)).toContain('expires_at > NOW()');
      expect(sqlOf(lookup)).toContain('FOR UPDATE');
      expect(lookup[1]).toEqual([hashToken(TOKEN)]);
      expect(calls.find((c) => sqlOf(c).startsWith('UPDATE users SET password_hash'))![1]).toEqual(['hashed:newpassword1', 'u1']);
      // Every existing session ends, in the same transaction as the password change.
      const sqls = calls.map(sqlOf);
      const revoke = sqls.findIndex((q) => q.startsWith('UPDATE users SET token_version = token_version + 1'));
      expect(revoke).toBeGreaterThan(sqls.indexOf('BEGIN'));
      expect(revoke).toBeLessThan(sqls.indexOf('COMMIT'));
      expect(calls.map(sqlOf)).toContain('DELETE FROM password_reset_tokens WHERE user_id = $1');
      expect(calls.find((c) => sqlOf(c).startsWith('INSERT INTO activity_log'))![1]).toEqual(['o1', 'u1', 'user', 'u1', 'password_reset', '{}']);
      expect(calls.map(sqlOf)).toContain('COMMIT');
    });

    it('rejects unknown, used or expired tokens with 400 and rolls back', async () => {
      mockClient.query.mockImplementation(async () => rows());

      const res = await reset({ token: TOKEN, password: 'newpassword1' });

      expect(res.statusCode).toBe(400);
      const sqls = mockClient.query.mock.calls.map(sqlOf);
      expect(sqls).toContain('ROLLBACK');
      expect(sqls.some((s) => s.startsWith('UPDATE users'))).toBe(false);
    });

    it('rejects malformed tokens and short passwords before touching the database', async () => {
      expect((await reset({ token: "' OR 1=1 --", password: 'newpassword1' })).statusCode).toBe(400);
      expect((await reset({ token: TOKEN, password: 'short' })).statusCode).toBe(400);
      expect(db.getClient).not.toHaveBeenCalled();
    });
  });
});
