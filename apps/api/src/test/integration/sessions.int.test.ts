import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REGISTER_CONFLICT } from '../../routes/auth';
import { db } from '../../db/client';
import { waitForJob } from './fakes';
import { registerOrg, row, startApp, unique, type App } from './harness';

/** H.3: sessions end on logout, password change and password reset; register does not reveal emails. */
describe('sessions and revocation (real Postgres)', () => {
  let app: App;

  // A fresh app per test: auth routes are rate-limited per app instance.
  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const me = (token: string) => app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
  const login = async (email: string, password: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  };

  it('logout ends every session of the user, on every device', async () => {
    const admin = await registerOrg(app, 'password123');
    const laptop = await login(admin.email, 'password123');
    const phone = await login(admin.email, 'password123');
    expect((await me(laptop)).statusCode).toBe(200);
    expect((await me(phone)).statusCode).toBe(200);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(laptop) });
    expect(out.statusCode).toBe(200);

    expect((await me(laptop)).statusCode).toBe(401);
    expect((await me(phone)).statusCode).toBe(401);
    expect(await row('SELECT token_version FROM users WHERE id = $1', [admin.userId])).toEqual({ token_version: 1 });

    // Signing in again works, with the new version.
    expect((await me(await login(admin.email, 'password123'))).statusCode).toBe(200);
  });

  it('a password change keeps the current session and ends all others', async () => {
    const admin = await registerOrg(app, 'password123');
    const current = await login(admin.email, 'password123');
    const other = await login(admin.email, 'password123');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/profile/me',
      headers: bearer(current),
      payload: { password: 'brand-new-password', current_password: 'password123' },
    });
    expect(res.statusCode).toBe(200);

    const reissued = res.cookies.find((c) => c.name === 'auth_token')!.value;
    expect((await me(reissued)).statusCode).toBe(200);
    expect((await me(current)).statusCode).toBe(401);
    expect((await me(other)).statusCode).toBe(401);
  });

  it('a stolen session cannot change the password without knowing the current one', async () => {
    const admin = await registerOrg(app, 'password123');
    const session = await login(admin.email, 'password123');
    const change = (payload: object) => app.inject({ method: 'PATCH', url: '/api/profile/me', headers: bearer(session), payload });

    expect((await change({ password: 'attacker-password' })).statusCode).toBe(400);
    const wrong = await change({ password: 'attacker-password', current_password: 'a-guess' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'Your current password is incorrect.' });

    // Nothing changed: the old password still signs in, the session still works, and the attempt is audited.
    expect((await me(session)).statusCode).toBe(200);
    const attackerLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: admin.email, password: 'attacker-password' } });
    expect(attackerLogin.statusCode).toBe(401);
    expect((await me(await login(admin.email, 'password123'))).statusCode).toBe(200);
    expect(await row('SELECT token_version FROM users WHERE id = $1', [admin.userId])).toEqual({ token_version: 0 });
    await expect
      .poll(async () => (await db.query("SELECT 1 FROM audit_log WHERE actor_id = $1 AND action = 'auth.password_change_failed'", [admin.userId])).length)
      .toBe(1);
  });

  it('a password reset ends every existing session', async () => {
    const admin = await registerOrg(app, 'password123');
    const session = await login(admin.email, 'password123');

    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: admin.email } });
    const job = await waitForJob((j) => j.name === 'password_reset_requested' && j.data.user_id === admin.userId);
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: job.data.token, password: 'after-reset-pw' } });
    expect(reset.statusCode).toBe(200);

    expect((await me(session)).statusCode).toBe(401);
    expect((await me(await login(admin.email, 'after-reset-pw'))).statusCode).toBe(200);
  });

  it('authorizes with the current role, not the one in the token', async () => {
    const admin = await registerOrg(app);
    // An admin may create invites; demote them without issuing a new token.
    await db.query("UPDATE users SET role = 'viewer' WHERE id = $1", [admin.userId]);

    const res = await app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email: `x-${unique()}@example.com` } });

    expect(res.statusCode).toBe(403);
    expect((await me(admin.auth.authorization.slice('Bearer '.length))).json().user.role).toBe('viewer');
  });

  it('rejects the token of a deleted user', async () => {
    const admin = await registerOrg(app);
    const other = await registerOrg(app);
    // Move the user's row out from under the token: delete it.
    await db.query('DELETE FROM users WHERE id = $1', [admin.userId]);

    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: admin.auth })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/projects', headers: other.auth })).statusCode).toBe(200);
  });

  it('register answers a taken email exactly like a taken slug', async () => {
    const id = unique();
    const base = { org_name: 'Org', password: 'password123', name: 'Someone' };
    const register = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...base, ...payload } });
    expect((await register({ org_slug: `taken-${id}`, email: `taken-${id}@example.com` })).statusCode).toBe(201);

    const emailTaken = await register({ org_slug: `fresh-${id}`, email: `taken-${id}@example.com` });
    const slugTaken = await register({ org_slug: `taken-${id}`, email: `fresh-${id}@example.com` });

    expect(emailTaken.statusCode).toBe(409);
    expect(slugTaken.statusCode).toBe(409);
    expect(emailTaken.json()).toEqual({ error: REGISTER_CONFLICT });
    expect(slugTaken.json()).toEqual(emailTaken.json());
  });
});
