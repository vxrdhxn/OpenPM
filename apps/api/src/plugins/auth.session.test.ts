import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../db/client', () => ({ db: { query: vi.fn() } }));

import { db } from '../db/client';
import { authFailuresTotal } from '../metrics';
import authPlugin from './auth';

/** The real session check (database verifier): revocation via token_version, and the current role. */
describe('session verification (token_version)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    authFailuresTotal.reset();
    app = Fastify({ logger: false });
    await app.register(authPlugin); // default: databaseSessionVerifier
    app.get('/whoami', { preValidation: app.authenticate }, async (request) => request.user);
    app.get('/admin', { preValidation: app.authenticate, preHandler: app.requireRole('admin') }, async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (url: string, claims: Record<string, unknown>) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${app.jwt.sign({ user_id: 'u1', org_id: 'o1', role: 'admin', ...claims })}` } });
  const failures = async (reason: string) =>
    (await authFailuresTotal.get()).values.find((v) => v.labels.reason === reason)?.value ?? 0;

  it('accepts a token whose version matches, scoped to the user AND org', async () => {
    vi.mocked(db.query).mockResolvedValue([{ role: 'admin', token_version: 2 }]);

    const res = await as('/whoami', { tv: 2 });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(db.query).mock.calls[0]![1]).toEqual(['u1', 'o1']);
  });

  it('rejects tokens that are unsigned or claim another algorithm (algorithm confusion)', async () => {
    vi.mocked(db.query).mockResolvedValue([{ role: 'owner', token_version: 0 }]);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = b64({ user_id: 'u1', org_id: 'o1', role: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 });
    const genuine = app.jwt.sign({ user_id: 'u1', org_id: 'o1', role: 'owner' });
    const forged = [
      `${b64({ alg: 'none', typ: 'JWT' })}.${claims}.`, // unsigned
      `${b64({ alg: 'RS256', typ: 'JWT' })}.${claims}.${genuine.split('.')[2]}`, // asymmetric claim
      `${b64({ alg: 'HS512', typ: 'JWT' })}.${claims}.${genuine.split('.')[2]}`, // another HMAC, reused signature
    ];
    for (const token of forged) {
      const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode, token.split('.')[0]).toBe(401);
    }
    expect(vi.mocked(db.query)).not.toHaveBeenCalled(); // rejected before any session lookup
  });

  it('rejects a token issued before the last revocation', async () => {
    vi.mocked(db.query).mockResolvedValue([{ role: 'admin', token_version: 3 }]);

    const res = await as('/whoami', { tv: 2 });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    expect(await failures('revoked')).toBe(1);
  });

  it('treats a token without tv (issued before migration 012) as version 0', async () => {
    vi.mocked(db.query).mockResolvedValue([{ role: 'admin', token_version: 0 }]);
    expect((await as('/whoami', {})).statusCode).toBe(200);

    vi.mocked(db.query).mockResolvedValue([{ role: 'admin', token_version: 1 }]);
    expect((await as('/whoami', {})).statusCode).toBe(401);
  });

  it('rejects the token of a user who no longer exists in that organization', async () => {
    vi.mocked(db.query).mockResolvedValue([]);

    expect((await as('/whoami', { tv: 0 })).statusCode).toBe(401);
  });

  it('authorizes with the role as stored now, not the one in the token', async () => {
    // The token says admin; the user has since been made a viewer.
    vi.mocked(db.query).mockResolvedValue([{ role: 'viewer', token_version: 0 }]);

    const res = await as('/admin', { tv: 0 });

    expect(res.statusCode).toBe(403);
  });

  it('does not query the database for a token that fails signature checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: 'Bearer garbage' } });

    expect(res.statusCode).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});
