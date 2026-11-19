import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config';
import { db } from '../../db/client';
import { REGISTER_CONFLICT } from '../../routes/auth';
import { jobs, waitForJob } from './fakes';
import { registerOrg, row, startApp, unique, type App } from './harness';

/** Verify-by-email sign-up (docs/signup.md), against real Postgres. */
describe('verified sign-up (real Postgres)', () => {
  let app: App;
  const saved = config.SIGNUP_VERIFICATION;

  beforeEach(async () => {
    config.SIGNUP_VERIFICATION = 'required';
    app = await startApp();
  });

  afterEach(async () => {
    config.SIGNUP_VERIFICATION = saved;
    await app.close();
  });

  const form = (over: Record<string, string> = {}) => {
    const id = unique();
    return { org_name: `Org ${id}`, org_slug: `org-${id}`, email: `owner-${id}@example.com`, password: 'password123', name: `Owner ${id}`, ...over };
  };
  const register = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/register', payload });
  const verify = (token: string) => app.inject({ method: 'POST', url: '/api/auth/verify-signup', payload: { token } });
  /** The newest link emailed for this address (signing up again keeps the request id, with a new token). */
  const linkFor = async (email: string) => {
    const pending = await row<{ id: string }>('SELECT id FROM signup_requests WHERE email = $1', [email]);
    const isLink = (j: (typeof jobs)[number]) => j.name === 'signup_verification' && j.data.signup_id === pending?.id;
    await waitForJob(isLink);
    return jobs.filter(isLink).at(-1)!.data.token as string;
  };
  const waitForRequest = async (email: string) => {
    await expect.poll(async () => (await row('SELECT 1 FROM signup_requests WHERE email = $1', [email])) !== undefined).toBe(true);
  };

  it('creates nothing until the emailed link is opened, then creates the workspace and signs its owner in', async () => {
    const f = form();
    const res = await register(f);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ verification: 'email', message: expect.stringMatching(/check your email/i) });
    expect(res.cookies.find((c) => c.name === 'auth_token')).toBeUndefined();

    await waitForRequest(f.email);
    expect(await row('SELECT 1 FROM users WHERE email = $1', [f.email])).toBeUndefined();
    expect(await row('SELECT 1 FROM organizations WHERE slug = $1', [f.org_slug])).toBeUndefined();
    // The stored request has no plain password or token.
    const stored = (await row<Record<string, string>>('SELECT * FROM signup_requests WHERE email = $1', [f.email]))!;
    const token = await linkFor(f.email);
    expect(JSON.stringify(stored)).not.toContain(f.password);
    expect(JSON.stringify(stored)).not.toContain(token);

    const done = await verify(token);
    expect(done.statusCode).toBe(201);
    expect(done.cookies.find((c) => c.name === 'auth_token')).toBeDefined();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${done.json().token}` } });
    expect(me.json().user).toMatchObject({ role: 'owner' });
    expect(await row('SELECT role FROM users WHERE email = $1', [f.email])).toEqual({ role: 'owner' });

    // Single use.
    expect((await verify(token)).statusCode).toBe(400);
    expect(await row('SELECT 1 FROM signup_requests WHERE email = $1', [f.email])).toBeUndefined();
    // Signing in uses the password from the form.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: f.email, password: f.password } })).statusCode).toBe(200);
  });

  it('answers a registered address exactly like a new one, and tells its owner instead of signing up', async () => {
    config.SIGNUP_VERIFICATION = 'off';
    const owner = await registerOrg(app);
    config.SIGNUP_VERIFICATION = 'required';

    const fresh = await register(form());
    const taken = await register(form({ email: owner.email }));
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.json()).toEqual(fresh.json());

    const notice = await waitForJob((j) => j.name === 'signup_existing_account' && j.data.user_id === owner.userId);
    expect(notice.data).toMatchObject({ org_id: owner.orgId });
    expect(notice.data).not.toHaveProperty('token');
    expect(await row('SELECT 1 FROM signup_requests WHERE email = $1', [owner.email])).toBeUndefined();

    // At most one notice an hour: the same job id.
    await register(form({ email: owner.email }));
    await new Promise((r) => setTimeout(r, 200));
    const ids = jobs.filter((j) => j.name === 'signup_existing_account' && j.data.user_id === owner.userId).map((j) => j.opts?.jobId);
    expect(new Set(ids).size).toBe(1);
  });

  it('refuses a taken organization URL up front (it says nothing about any email)', async () => {
    config.SIGNUP_VERIFICATION = 'off';
    const existing = await registerOrg(app);
    config.SIGNUP_VERIFICATION = 'required';
    const slug = (await row<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [existing.orgId]))!.slug;

    const res = await register(form({ org_slug: slug }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/organization URL is taken/);
  });

  it('signing up again replaces the earlier link', async () => {
    const f = form();
    await register(f);
    await waitForRequest(f.email);
    const first = await linkFor(f.email);

    await register({ ...f, name: 'Second try' });
    await expect.poll(async () => (await linkFor(f.email)) !== first).toBe(true);
    const second = await linkFor(f.email);

    expect((await verify(first)).statusCode).toBe(400);
    expect((await verify(second)).statusCode).toBe(201);
    expect(await row('SELECT name FROM users WHERE email = $1', [f.email])).toEqual({ name: 'Second try' });
  });

  it('refuses an expired link, and a link whose URL was taken in the meantime', async () => {
    const late = form();
    await register(late);
    await waitForRequest(late.email);
    const lateToken = await linkFor(late.email);
    await db.query("UPDATE signup_requests SET expires_at = NOW() - interval '1 minute' WHERE email = $1", [late.email]);
    expect((await verify(lateToken)).statusCode).toBe(400);

    const a = form();
    await register(a);
    await waitForRequest(a.email);
    const aToken = await linkFor(a.email);
    // Someone else takes the same URL first.
    config.SIGNUP_VERIFICATION = 'off';
    expect((await register(form({ org_slug: a.org_slug }))).statusCode).toBe(201);
    config.SIGNUP_VERIFICATION = 'required';

    const res = await verify(aToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/taken after you signed up/);
    expect(await row('SELECT 1 FROM users WHERE email = $1', [a.email])).toBeUndefined();
    expect((await verify(aToken)).statusCode).toBe(400); // the request is gone
  });

  it('without verification, signs up at once as before', async () => {
    config.SIGNUP_VERIFICATION = 'off';
    const res = await register(form());
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toEqual(expect.any(String));
    expect(REGISTER_CONFLICT).toMatch(/sign in/);
  });
});
