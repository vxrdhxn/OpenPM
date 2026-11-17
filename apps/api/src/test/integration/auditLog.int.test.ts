import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { pruneAuditLog } from '../../security/audit';
import { addUser, createProject, registerOrg, startApp, type Actor, type App } from './harness';

/** The security audit log (docs/audit-log.md), against real Postgres. */
describe('security audit log (real Postgres)', () => {
  let app: App;
  let owner: Actor;

  // A fresh app per test: sign-in and register are rate-limited per app instance.
  beforeEach(async () => {
    app = await startApp();
    owner = await registerOrg(app);
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...actor.auth, ...headers }, payload });
  const entries = async (actor: Actor = owner, query = '') => {
    const res = await call(actor, 'GET', `/api/audit${query}`);
    expect(res.statusCode).toBe(200);
    return res.json().items as Array<Record<string, any>>;
  };
  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { 'user-agent': 'audit-test/1.0' } });

  it('records the sign-up, sign-ins, a failed sign-in and the sign-out, with where they came from', async () => {
    expect((await login(owner.email, 'wrong-password')).statusCode).toBe(401);
    const ok = await login(owner.email, 'password123');
    expect(ok.statusCode).toBe(200);
    const session = { userId: owner.userId, orgId: owner.orgId, role: 'owner', email: owner.email, auth: { authorization: `Bearer ${ok.json().token}` } };
    expect((await call(session, 'POST', '/api/auth/logout')).statusCode).toBe(200);

    // Signing out ended every session of the owner's, so another admin reads the log. The failed
    // attempt is written without being awaited (timing); give it a moment.
    const admin = await addUser(app, owner.orgId, 'admin');
    await expect.poll(async () => (await entries(admin, '?action=auth.login_failed')).length).toBe(1);

    const all = await entries(admin);
    expect(all.map((e) => e.action)).toEqual(['auth.logout', 'auth.login', 'auth.login_failed', 'auth.registered']);
    const failed = all.find((e) => e.action === 'auth.login_failed')!;
    expect(failed).toMatchObject({ actor_id: null, target_type: 'user', target_id: owner.userId, user_agent: 'audit-test/1.0' });
    expect(failed.ip).toBeTruthy();
    expect(all.find((e) => e.action === 'auth.login')).toMatchObject({ actor_id: owner.userId, actor_email: owner.email });
  });

  it('does not record anything for an email nobody has, so no workspace learns about other people', async () => {
    // Entries carry the request id, so this finds anything this one request wrote (other test files
    // write to the table at the same time).
    const known = await login(owner.email, 'wrong-password');
    const unknown = await login('nobody-here@example.com', 'whatever123');
    expect(unknown.statusCode).toBe(401);
    const written = (res: typeof known) =>
      db.query('SELECT 1 FROM audit_log WHERE request_id = $1', [res.headers['x-request-id']]).then((r) => r.length);
    await expect.poll(() => written(known)).toBe(1); // the check itself works
    await new Promise((r) => setTimeout(r, 100));
    expect(await written(unknown)).toBe(0);
  });

  it('records password changes, role changes, removals and project access changes, never secrets', async () => {
    const member = await addUser(app, owner.orgId, 'member');
    const viewer = await addUser(app, owner.orgId, 'viewer');

    // (The member's own session ends with the password change; the owner's must keep working here.)
    expect((await call(member, 'PATCH', '/api/profile/me', { password: 'a-new-password-1' })).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/members/${member.userId}`, { role: 'admin' })).statusCode).toBe(200);
    expect((await call(owner, 'DELETE', `/api/members/${viewer.userId}`)).statusCode).toBe(204);

    const project = await createProject(app, owner);
    expect((await call(owner, 'PATCH', `/api/projects/${project.id}`, { visibility: 'private' })).statusCode).toBe(200);
    expect((await call(owner, 'POST', `/api/projects/${project.id}/members`, { user_id: member.userId })).statusCode).toBe(201);
    expect((await call(owner, 'DELETE', `/api/projects/${project.id}/members/${member.userId}`)).statusCode).toBe(204);

    const all = await entries();
    expect(all.map((e) => e.action)).toEqual([
      'project.member_removed',
      'project.member_added',
      'project.visibility_changed',
      'member.removed',
      'member.role_changed',
      'auth.password_changed',
      'auth.registered',
    ]);
    expect(all.find((e) => e.action === 'member.role_changed')).toMatchObject({
      target_id: member.userId,
      target_name: 'member user',
      metadata: { from: 'member', to: 'admin' },
    });
    expect(all.find((e) => e.action === 'project.visibility_changed')!.metadata).toMatchObject({ from: 'workspace', to: 'private' });
    expect(JSON.stringify(all)).not.toContain('a-new-password-1');

    // Filter by person: what they did, and what was done to them.
    const aboutMember = await entries(owner, `?user_id=${member.userId}`);
    expect(aboutMember.map((e) => e.action)).toEqual(['member.role_changed', 'auth.password_changed']);
  });

  it('is for admins and owners only, and only ever shows the caller’s own workspace', async () => {
    const member = await addUser(app, owner.orgId, 'member');
    expect((await call(member, 'GET', '/api/audit')).statusCode).toBe(403);

    const other = await registerOrg(app);
    const theirs = await entries(other);
    expect(theirs.every((e) => e.actor_id !== owner.userId && e.target_id !== owner.userId)).toBe(true);
    expect(theirs.map((e) => e.action)).toEqual(['auth.registered']);
  });

  it('cannot be written to through the API', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      expect((await call(owner, method, '/api/audit', {})).statusCode).toBe(404);
    }
  });

  it('rejects unknown filters', async () => {
    expect((await call(owner, 'GET', '/api/audit?action=drop_tables')).statusCode).toBe(400);
    expect((await call(owner, 'GET', '/api/audit?org_id=00000000-0000-0000-0000-000000000000')).statusCode).toBe(400);
  });

  it('deletes entries older than the retention period, and keeps the rest', async () => {
    await db.query(
      `INSERT INTO audit_log (org_id, actor_id, action, created_at) VALUES ($1, $2, 'auth.login', NOW() - interval '400 days')`,
      [owner.orgId, owner.userId]
    );
    expect(await pruneAuditLog(365, 1)).toBeGreaterThanOrEqual(1);
    const left = await entries();
    expect(left.map((e) => e.action)).toEqual(['auth.registered']);
  });
});
