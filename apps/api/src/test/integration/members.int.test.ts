import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, createProject, createTask, registerOrg, row, startApp, type Actor, type App } from './harness';

/** Phase I: member list, role changes, removal and leaving, against real Postgres. */
describe('members (real Postgres)', () => {
  let app: App;

  // A fresh app per test: register is rate-limited (10/min) per app instance, and these tests
  // create many organizations.
  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: actor.auth, payload });
  const me = (actor: Actor) => app.inject({ method: 'GET', url: '/api/auth/me', headers: actor.auth });

  describe('listing', () => {
    it('lists active members of the caller org only, without secrets', async () => {
      const admin = await registerOrg(app);
      const viewer = await addUser(app, admin.orgId, 'viewer');
      const outsider = await registerOrg(app);

      const res = await call(viewer, 'GET', '/api/members');

      expect(res.statusCode).toBe(200);
      const ids = res.json().map((m: { id: string }) => m.id);
      expect(ids).toEqual([admin.userId, viewer.userId]);
      expect(ids).not.toContain(outsider.userId);
      expect(Object.keys(res.json()[0]).sort()).toEqual(['created_at', 'email', 'id', 'name', 'role']);
    });
  });

  describe('changing roles', () => {
    let admin: Actor;
    let member: Actor;

    beforeEach(async () => {
      admin = await registerOrg(app);
      member = await addUser(app, admin.orgId, 'member');
    });

    it('lets an admin promote and demote, takes effect at once, and is audited', async () => {
      const up = await call(admin, 'PATCH', `/api/members/${member.userId}`, { role: 'admin' });
      expect(up.statusCode).toBe(200);
      expect(up.json()).toMatchObject({ id: member.userId, role: 'admin' });

      // The member's existing token now acts with the new role (no new login needed).
      expect((await me(member)).json().user.role).toBe('admin');

      expect(await row('SELECT user_id, action, metadata FROM activity_log WHERE entity_id = $1 AND action = $2', [member.userId, 'role_changed']))
        .toEqual({ user_id: admin.userId, action: 'role_changed', metadata: { from: 'member', to: 'admin' } });
    });

    it('refuses changes by non-admins, on equals, on yourself, and above your own role', async () => {
      const otherAdmin = await addUser(app, admin.orgId, 'admin');

      expect((await call(member, 'PATCH', `/api/members/${admin.userId}`, { role: 'viewer' })).statusCode).toBe(403);
      expect((await call(admin, 'PATCH', `/api/members/${otherAdmin.userId}`, { role: 'viewer' })).statusCode).toBe(403);
      expect((await call(admin, 'PATCH', `/api/members/${admin.userId}`, { role: 'viewer' })).statusCode).toBe(403);
      expect((await call(admin, 'PATCH', `/api/members/${member.userId}`, { role: 'owner' })).statusCode).toBe(403);
      expect(await row('SELECT role FROM users WHERE id = $1', [member.userId])).toEqual({ role: 'member' });
    });

    it('rejects unknown roles and extra fields', async () => {
      expect((await call(admin, 'PATCH', `/api/members/${member.userId}`, { role: 'superuser' })).statusCode).toBe(400);
      expect((await call(admin, 'PATCH', `/api/members/${member.userId}`, { role: 'viewer', org_id: admin.orgId })).statusCode).toBe(400);
    });

    it('lets an owner demote an admin, but nobody demote themselves (so a manager always remains)', async () => {
      const owner = await addUser(app, admin.orgId, 'owner');

      expect((await call(owner, 'PATCH', `/api/members/${admin.userId}`, { role: 'member' })).statusCode).toBe(200);
      // The owner is now the only manager. Only they could demote themselves, and they may not.
      expect((await call(owner, 'PATCH', `/api/members/${owner.userId}`, { role: 'member' })).statusCode).toBe(403);
      expect(await row('SELECT role FROM users WHERE id = $1', [owner.userId])).toEqual({ role: 'owner' });
    });
  });

  describe('cross-tenant', () => {
    it('cannot see, change or remove a member of another organization', async () => {
      const a = await registerOrg(app);
      const b = await registerOrg(app);
      const victim = await addUser(app, a.orgId, 'member');

      expect((await call(b, 'PATCH', `/api/members/${victim.userId}`, { role: 'viewer' })).statusCode).toBe(404);
      expect((await call(b, 'DELETE', `/api/members/${victim.userId}`)).statusCode).toBe(404);
      expect(await row('SELECT role, deactivated_at FROM users WHERE id = $1', [victim.userId])).toEqual({ role: 'member', deactivated_at: null });
    });
  });

  describe('removing', () => {
    it('deactivates the member: sessions end, data and history stay, tasks are unassigned', async () => {
      const admin = await registerOrg(app);
      const member = await addUser(app, admin.orgId, 'member');
      const project = await createProject(app, member, 'Made by the member');
      const task = await createTask(app, admin, project.id, { assignee_id: member.userId });

      const res = await call(admin, 'DELETE', `/api/members/${member.userId}`);
      expect(res.statusCode).toBe(204);

      expect((await me(member)).statusCode).toBe(401);
      const user = await row<{ email: string; name: string; deactivated_at: Date | null; password_hash: string }>(
        'SELECT email, name, deactivated_at, password_hash FROM users WHERE id = $1',
        [member.userId]
      );
      expect(user!.deactivated_at).not.toBeNull();
      expect(user!.email).toBe(`removed-${member.userId}@removed.invalid`);
      expect(user!.password_hash).toBe('!removed');
      expect(user!.name).toBe('member user'); // kept for history

      // What they created stays; what was assigned to them is unassigned.
      expect(await row('SELECT id FROM projects WHERE id = $1', [project.id])).toEqual({ id: project.id });
      expect(await row('SELECT assignee_id FROM tasks WHERE id = $1', [task.id])).toEqual({ assignee_id: null });

      // Gone from the list, cannot be assigned again.
      expect((await call(admin, 'GET', '/api/members')).json().map((m: { id: string }) => m.id)).not.toContain(member.userId);
      expect((await call(admin, 'PATCH', `/api/projects/${project.id}/tasks/${task.id}`, { assignee_id: member.userId })).statusCode).toBe(400);

      expect(await row('SELECT action, metadata FROM activity_log WHERE entity_id = $1 AND action = $2', [member.userId, 'removed']))
        .toMatchObject({ metadata: { role: 'member' } });
    });

    it('frees the email so the person can be invited back', async () => {
      const admin = await registerOrg(app);
      const member = await addUser(app, admin.orgId, 'member');

      await call(admin, 'DELETE', `/api/members/${member.userId}`);
      const invite = await call(admin, 'POST', '/api/invites', { email: member.email });

      expect(invite.statusCode).toBe(201);
    });

    it('cannot remove yourself (the last manager stays), or a removed member twice', async () => {
      const admin = await registerOrg(app);
      const owner = await addUser(app, admin.orgId, 'owner');
      await db.query("UPDATE users SET role = 'member' WHERE id = $1", [admin.userId]);

      // Owner is now the only manager and cannot be removed by anyone (owners can't remove themselves).
      expect((await call(owner, 'DELETE', `/api/members/${owner.userId}`)).statusCode).toBe(403);

      const member = await addUser(app, admin.orgId, 'member');
      expect((await call(owner, 'DELETE', `/api/members/${member.userId}`)).statusCode).toBe(204);
      expect((await call(owner, 'DELETE', `/api/members/${member.userId}`)).statusCode).toBe(404);
    });
  });

  describe('leaving', () => {
    it('lets a member leave: cookie cleared, session ended, audited', async () => {
      const admin = await registerOrg(app);
      const member = await addUser(app, admin.orgId, 'member');

      const res = await call(member, 'POST', '/api/members/leave');

      expect(res.statusCode).toBe(200);
      expect(String(res.headers['set-cookie'])).toMatch(/auth_token=;/);
      expect((await me(member)).statusCode).toBe(401);
      expect(await row('SELECT user_id FROM activity_log WHERE entity_id = $1 AND action = $2', [member.userId, 'left'])).toEqual({ user_id: member.userId });
    });

    it('stops the last admin from leaving, but lets an admin leave when another remains', async () => {
      const admin = await registerOrg(app);
      expect((await call(admin, 'POST', '/api/members/leave')).statusCode).toBe(409);
      expect((await me(admin)).statusCode).toBe(200);

      const second = await addUser(app, admin.orgId, 'admin');
      expect((await call(admin, 'POST', '/api/members/leave')).statusCode).toBe(200);
      expect((await me(second)).statusCode).toBe(200);
    });

    it('serializes concurrent changes: two last admins leaving at once leaves one behind', async () => {
      const a = await registerOrg(app);
      const b = await addUser(app, a.orgId, 'admin');

      const results = await Promise.all([call(a, 'POST', '/api/members/leave'), call(b, 'POST', '/api/members/leave')]);

      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const managers = await row<{ n: string }>(
        "SELECT count(*) AS n FROM users WHERE org_id = $1 AND deactivated_at IS NULL AND role IN ('owner','admin')",
        [a.orgId]
      );
      expect(Number(managers!.n)).toBe(1);
    });
  });
});
