import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobs, waitForJob } from './fakes';
import { registerOrg, row, startApp, unique, type App } from './harness';

describe('account flows (real Postgres)', () => {
  let app: App;

  // A fresh app per test: auth routes are rate-limited per app instance (rateLimit.int.test.ts covers that).
  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  const login = (email: string, password: string) => post('/api/auth/login', { email, password });

  describe('register and login', () => {
    it('creates the org and an admin, who can then log in', async () => {
      const admin = await registerOrg(app, 'first-password');

      expect(admin.role).toBe('admin');
      expect(await row('SELECT role, org_id FROM users WHERE id = $1', [admin.userId])).toEqual({ role: 'admin', org_id: admin.orgId });
      expect((await login(admin.email, 'first-password')).statusCode).toBe(200);
      expect((await login(admin.email, 'wrong-password')).statusCode).toBe(401);
    });

    it('stores a bcrypt hash, never the password', async () => {
      const admin = await registerOrg(app, 'plain-text-check');
      const user = await row<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [admin.userId]);

      expect(user!.password_hash).toMatch(/^\$2[aby]\$12\$/);
      expect(user!.password_hash).not.toContain('plain-text-check');
    });

    it('rejects a taken slug or email with 409 and creates nothing', async () => {
      const id = unique();
      const first = await post('/api/auth/register', { org_name: 'One', org_slug: `dup-${id}`, email: `dup-${id}@example.com`, password: 'password123', name: 'One' });
      expect(first.statusCode).toBe(201);

      const sameSlug = await post('/api/auth/register', { org_name: 'Two', org_slug: `dup-${id}`, email: `other-${id}@example.com`, password: 'password123', name: 'Two' });
      expect(sameSlug.statusCode).toBe(409);
      expect(await row('SELECT id FROM users WHERE email = $1', [`other-${id}@example.com`])).toBeUndefined();
    });
  });

  describe('password reset', () => {
    it('emails a working single-use link; the old password stops working', async () => {
      const admin = await registerOrg(app, 'old-password');

      expect((await post('/api/auth/forgot-password', { email: admin.email.toUpperCase() })).statusCode).toBe(200);
      const job = await waitForJob((j) => j.name === 'password_reset_requested' && j.data.user_id === admin.userId);

      // Only the hash is stored.
      const stored = await row<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1', [admin.userId]);
      expect(stored!.token_hash).not.toBe(job.data.token);

      expect((await post('/api/auth/reset-password', { token: job.data.token, password: 'new-password' })).statusCode).toBe(200);
      expect((await login(admin.email, 'old-password')).statusCode).toBe(401);
      expect((await login(admin.email, 'new-password')).statusCode).toBe(200);
      expect((await post('/api/auth/reset-password', { token: job.data.token, password: 'third-password' })).statusCode).toBe(400);
      expect(await row("SELECT action FROM activity_log WHERE entity_id = $1 AND action = 'password_reset'", [admin.userId])).toBeDefined();
    });

    it('only the newest link works', async () => {
      const admin = await registerOrg(app);
      const forUser = (j: (typeof jobs)[number]) => j.name === 'password_reset_requested' && j.data.user_id === admin.userId;

      await post('/api/auth/forgot-password', { email: admin.email });
      const first = await waitForJob(forUser);
      await post('/api/auth/forgot-password', { email: admin.email });
      await waitForJob((j) => forUser(j) && j !== first);
      const second = jobs.filter(forUser).at(-1)!;

      expect((await post('/api/auth/reset-password', { token: first.data.token, password: 'new-password' })).statusCode).toBe(400);
      expect((await post('/api/auth/reset-password', { token: second.data.token, password: 'new-password' })).statusCode).toBe(200);
    });

    it('rejects an expired link', async () => {
      const admin = await registerOrg(app);
      await post('/api/auth/forgot-password', { email: admin.email });
      const job = await waitForJob((j) => j.name === 'password_reset_requested' && j.data.user_id === admin.userId);
      await row("UPDATE password_reset_tokens SET expires_at = NOW() - interval '1 minute' WHERE user_id = $1 RETURNING id", [admin.userId]);

      expect((await post('/api/auth/reset-password', { token: job.data.token, password: 'new-password' })).statusCode).toBe(400);
    });
  });

  describe('invitations', () => {
    it('invite -> lookup -> accept creates the user in the inviting org with the invited role', async () => {
      const admin = await registerOrg(app);
      const email = `invitee-${unique()}@example.com`;

      const invite = await app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email, role: 'admin' } });
      expect(invite.statusCode).toBe(201);
      const job = await waitForJob((j) => j.name === 'invite_created' && j.data.invite_id === invite.json().id);

      const lookup = await post('/api/invites/lookup', { token: job.data.token });
      expect(lookup.statusCode).toBe(200);
      expect(lookup.json()).toMatchObject({ email, role: 'admin' });

      const accept = await post('/api/invites/accept', { token: job.data.token, name: 'New Person', password: 'password123' });
      expect(accept.statusCode).toBe(201);
      expect(await row('SELECT org_id, role FROM users WHERE email = $1', [email])).toEqual({ org_id: admin.orgId, role: 'admin' });
      expect((await login(email, 'password123')).statusCode).toBe(200);

      // Single use.
      expect((await post('/api/invites/accept', { token: job.data.token, name: 'Again', password: 'password123' })).statusCode).toBe(404);
      expect(await row('SELECT id FROM organization_invites WHERE id = $1', [invite.json().id])).toBeUndefined();
    });

    it('a re-sent invite invalidates the previous link', async () => {
      const admin = await registerOrg(app);
      const email = `resend-${unique()}@example.com`;
      const forEmail = (j: (typeof jobs)[number]) => j.name === 'invite_created' && j.data.org_id === admin.orgId;

      await app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email } });
      const first = await waitForJob(forEmail);
      await app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email } });
      const second = jobs.filter(forEmail).at(-1)!;

      expect((await post('/api/invites/lookup', { token: first.data.token })).statusCode).toBe(404);
      expect((await post('/api/invites/lookup', { token: second.data.token })).statusCode).toBe(200);
    });

    it('an email that already has an account cannot accept, and the invite is kept', async () => {
      const admin = await registerOrg(app);
      const other = await registerOrg(app);

      const invite = await app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email: other.email } });
      const job = await waitForJob((j) => j.name === 'invite_created' && j.data.invite_id === invite.json().id);

      const accept = await post('/api/invites/accept', { token: job.data.token, name: 'Hijack', password: 'password123' });
      expect(accept.statusCode).toBe(409);
      expect(await row('SELECT org_id FROM users WHERE id = $1', [other.userId])).toEqual({ org_id: other.orgId });
      expect(await row('SELECT id FROM organization_invites WHERE id = $1', [invite.json().id])).toBeDefined();
    });
  });
});
