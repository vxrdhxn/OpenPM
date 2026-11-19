import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { TRUST_TOKEN_CLAIMS } from '../test/auth';
import authPlugin from '../plugins/auth';
import { hashToken } from '../security/tokens';

vi.mock('../db/client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

const { queueAdd } = vi.hoisted(() => ({ queueAdd: vi.fn() }));
vi.mock('../queue', () => ({ getJobQueue: () => ({ add: queueAdd }) }));

vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hashed-password') } }));

import { db } from '../db/client';
import inviteRoutes from './invites';

const mockClient = { query: vi.fn(), release: vi.fn() };
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });

const TOKEN = 'a'.repeat(64);
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const inviteRow = { id: INVITE_ID, email: 'new@example.com', role: 'member', expires_at: '2026-11-22T00:00:00Z', created_at: '2026-11-15T00:00:00Z' };

describe('Invite routes', () => {
  let app: ReturnType<typeof Fastify>;
  let adminToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce values; a failing test must not leak them.
    mockClient.query.mockReset();
    vi.mocked(db.query).mockReset();
    app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    await app.register(cookie);
    await app.register(authPlugin, TRUST_TOKEN_CLAIMS);
    await app.register(inviteRoutes, { prefix: '/invites' });
    await app.ready();

    adminToken = app.jwt.sign({ user_id: 'admin-1', org_id: 'org-1', role: 'admin' });
    vi.mocked(db.getClient).mockResolvedValue(mockClient as never);
  });

  afterEach(async () => {
    await app.close();
  });

  const asAdmin = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` }, payload });

  describe('POST /invites', () => {
    it('stores only a hash of the token, emails the raw token via a job, and never returns either', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows()) // already-a-member check
        .mockResolvedValueOnce(rows()) // lock the organization
        .mockResolvedValueOnce(rows([{ n: 0 }])) // other invites
        .mockResolvedValueOnce(rows([inviteRow])) // upsert
        .mockResolvedValueOnce(rows()) // activity log
        .mockResolvedValueOnce(rows()); // COMMIT

      const res = await asAdmin('POST', '/invites', { email: 'New@Example.COM', role: 'member' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(inviteRow);
      expect(res.body).not.toMatch(/token/);

      // Email normalized; membership checked in the caller's org only.
      expect(mockClient.query).toHaveBeenNthCalledWith(2, 'SELECT id FROM users WHERE email = $1 AND org_id = $2', ['new@example.com', 'org-1']);

      const [upsertSql, upsertParams] = mockClient.query.mock.calls[4]!;
      expect(upsertSql).toContain('token_hash');
      expect(upsertSql).not.toMatch(/RETURNING \*/);
      expect(upsertParams.slice(0, 2)).toEqual(['org-1', 'new@example.com']);

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [jobName, data, opts] = queueAdd.mock.calls[0]!;
      expect(jobName).toBe('invite_created');
      expect(data).toMatchObject({ invite_id: INVITE_ID, org_id: 'org-1' });
      expect(data.token).toMatch(/^[0-9a-f]{64}$/);
      // The database gets the hash of exactly the token that is emailed.
      expect(upsertParams[2]).toBe(hashToken(data.token));
      expect(upsertParams[2]).not.toBe(data.token);
      expect(opts).toMatchObject({ removeOnComplete: true });

      expect(mockClient.query.mock.calls[5]![1]).toEqual(['org-1', 'admin-1', 'invite', INVITE_ID, 'created', JSON.stringify({ role: 'member' })]);
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
    });

    it('returns 409 and creates nothing once the organization holds the most invites it may', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows()) // already-a-member check
        .mockResolvedValueOnce(rows()) // lock the organization
        .mockResolvedValueOnce(rows([{ n: 500 }])) // other invites
        .mockResolvedValue(rows()); // ROLLBACK

      const res = await asAdmin('POST', '/invites', { email: 'one.more@example.com', role: 'member' });

      expect(res.statusCode).toBe(409);
      expect(mockClient.query.mock.calls.some((c) => String(c[0]).startsWith('INSERT INTO organization_invites'))).toBe(false);
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('returns 409 and queues nothing when the person is already in the organization', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows([{ id: 'user-2' }])) // already a member
        .mockResolvedValueOnce(rows()); // ROLLBACK

      const res = await asAdmin('POST', '/invites', { email: 'member@example.com' });

      expect(res.statusCode).toBe(409);
      expect(queueAdd).not.toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('rejects an owner role and unknown fields', async () => {
      expect((await asAdmin('POST', '/invites', { email: 'x@example.com', role: 'owner' })).statusCode).toBe(400);
      expect((await asAdmin('POST', '/invites', { email: 'x@example.com', org_id: 'org-2' })).statusCode).toBe(400);
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it('is forbidden for members and requires authentication', async () => {
      const memberToken = app.jwt.sign({ user_id: 'u', org_id: 'org-1', role: 'member' });
      const asMember = await app.inject({ method: 'POST', url: '/invites', headers: { authorization: `Bearer ${memberToken}` }, payload: { email: 'x@example.com' } });
      const anonymous = await app.inject({ method: 'POST', url: '/invites', payload: { email: 'x@example.com' } });

      expect(asMember.statusCode).toBe(403);
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('GET /invites', () => {
    it('lists only the caller org and never selects the token hash', async () => {
      vi.mocked(db.query).mockResolvedValueOnce([inviteRow]);

      const res = await asAdmin('GET', '/invites');

      expect(res.statusCode).toBe(200);
      const [sql, params] = vi.mocked(db.query).mock.calls[0]!;
      expect(sql).not.toContain('token');
      expect(params).toEqual(['org-1']);
    });
  });

  describe('DELETE /invites/:id', () => {
    it('revokes within the caller org and records it', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows([{ id: INVITE_ID }])) // delete
        .mockResolvedValueOnce(rows()) // activity log
        .mockResolvedValueOnce(rows()); // COMMIT

      const res = await asAdmin('DELETE', `/invites/${INVITE_ID}`);

      expect(res.statusCode).toBe(204);
      expect(mockClient.query.mock.calls[1]![1]).toEqual([INVITE_ID, 'org-1']);
      expect(mockClient.query.mock.calls[2]![1]).toEqual(['org-1', 'admin-1', 'invite', INVITE_ID, 'revoked', '{}']);
    });

    it('returns 404 for an invite in another organization', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows()) // delete matched nothing
        .mockResolvedValueOnce(rows()); // ROLLBACK

      const res = await asAdmin('DELETE', `/invites/${INVITE_ID}`);

      expect(res.statusCode).toBe(404);
      expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('rejects a malformed id', async () => {
      expect((await asAdmin('DELETE', '/invites/not-a-uuid')).statusCode).toBe(400);
    });
  });

  describe('POST /invites/lookup (public)', () => {
    it('returns the invite details, looked up by token hash', async () => {
      const details = { email: 'new@example.com', role: 'member', expires_at: '2026-11-22T00:00:00Z', org_name: 'Acme' };
      vi.mocked(db.query).mockResolvedValueOnce([details]);

      const res = await app.inject({ method: 'POST', url: '/invites/lookup', payload: { token: TOKEN } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(details);
      const [sql, params] = vi.mocked(db.query).mock.calls[0]!;
      expect(sql).toContain('expires_at > NOW()');
      expect(params).toEqual([hashToken(TOKEN)]);
    });

    it('returns 404 for an unknown or expired token', async () => {
      vi.mocked(db.query).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'POST', url: '/invites/lookup', payload: { token: TOKEN } });

      expect(res.statusCode).toBe(404);
    });

    it('rejects a malformed token without querying', async () => {
      const res = await app.inject({ method: 'POST', url: '/invites/lookup', payload: { token: "' OR 1=1 --" } });

      expect(res.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('POST /invites/accept (public)', () => {
    const accept = (payload: object) => app.inject({ method: 'POST', url: '/invites/accept', payload });
    const invite = { id: INVITE_ID, org_id: 'org-1', email: 'new@example.com', role: 'admin' };

    it('creates the user in the inviting org with the invited role, consumes the invite and signs them in', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows([invite])) // invite FOR UPDATE
        .mockResolvedValueOnce(rows()) // email not registered
        .mockResolvedValueOnce(rows([{ id: 'user-new' }])) // insert user
        .mockResolvedValueOnce(rows()) // delete invite
        .mockResolvedValueOnce(rows()) // activity log
        .mockResolvedValueOnce(rows()); // COMMIT

      const res = await accept({ token: TOKEN, name: 'New Person', password: 'correct horse' });

      expect(res.statusCode).toBe(201);

      const [lookupSql, lookupParams] = mockClient.query.mock.calls[1]!;
      expect(lookupSql).toContain('FOR UPDATE');
      expect(lookupSql).toContain('expires_at > NOW()');
      expect(lookupParams).toEqual([hashToken(TOKEN)]);

      // Org, email and role come from the invite; the password is stored hashed.
      expect(mockClient.query.mock.calls[3]![1]).toEqual(['org-1', 'new@example.com', 'hashed-password', 'New Person', 'admin']);
      expect(mockClient.query.mock.calls[4]).toEqual(['DELETE FROM organization_invites WHERE id = $1', [INVITE_ID]]);
      expect(mockClient.query.mock.calls[5]![1]).toEqual(['org-1', 'user-new', 'invite', INVITE_ID, 'accepted', JSON.stringify({ role: 'admin' })]);
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');

      const cookieHeader = String(res.headers['set-cookie']);
      expect(cookieHeader).toContain('auth_token=');
      expect(cookieHeader).toContain('HttpOnly');
      expect(app.jwt.verify(res.json().token)).toMatchObject({ user_id: 'user-new', org_id: 'org-1', role: 'admin' });
    });

    it('returns 404 and rolls back for an unknown or expired token', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows()) // no valid invite
        .mockResolvedValueOnce(rows()); // ROLLBACK

      const res = await accept({ token: TOKEN, name: 'New Person', password: 'correct horse' });

      expect(res.statusCode).toBe(404);
      expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('returns 409 and keeps the invite when the email already has an account', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows([invite]))
        .mockResolvedValueOnce(rows([{ id: 'someone' }])) // email registered
        .mockResolvedValueOnce(rows()); // ROLLBACK

      const res = await accept({ token: TOKEN, name: 'New Person', password: 'correct horse' });

      expect(res.statusCode).toBe(409);
      expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('returns 409 when the email is registered concurrently (unique violation)', async () => {
      mockClient.query
        .mockResolvedValueOnce(rows()) // BEGIN
        .mockResolvedValueOnce(rows([invite]))
        .mockResolvedValueOnce(rows())
        .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
        .mockResolvedValueOnce(rows()); // ROLLBACK

      const res = await accept({ token: TOKEN, name: 'New Person', password: 'correct horse' });

      expect(res.statusCode).toBe(409);
    });

    it('does not let the request choose the organization, role or email', async () => {
      for (const extra of [{ org_id: 'org-2' }, { role: 'owner' }, { email: 'other@example.com' }]) {
        const res = await accept({ token: TOKEN, name: 'New Person', password: 'correct horse', ...extra });
        expect(res.statusCode).toBe(400);
      }
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it('enforces the password and name rules', async () => {
      expect((await accept({ token: TOKEN, name: 'New Person', password: 'short' })).statusCode).toBe(400);
      expect((await accept({ token: TOKEN, name: 'N', password: 'correct horse' })).statusCode).toBe(400);
    });
  });
});
