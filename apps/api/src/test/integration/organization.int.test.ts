import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { waitForJob } from './fakes';
import { addUser, createProject, createTask, registerOrg, row, startApp, unique, type Actor, type App } from './harness';

/** Organizations: owners, ownership transfer, settings, deletion and declined invites (real Postgres). */
describe('organizations (real Postgres)', () => {
  let app: App;

  // A fresh app per test: register is rate-limited (10/min) per app instance.
  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (actor: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: actor.auth, payload });
  const roleOf = async (userId: string) => (await row<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]))?.role;
  const slugOf = async (orgId: string) => (await row<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [orgId]))!.slug;

  describe('owners', () => {
    it('makes the person who signs up the owner', async () => {
      const owner = await registerOrg(app);
      expect(owner.role).toBe('owner');
      expect(await roleOf(owner.userId)).toBe('owner');
    });

    it('never leaves an organization without an owner: the last one cannot leave, be removed or be demoted', async () => {
      const owner = await registerOrg(app);
      await addUser(app, owner.orgId, 'admin'); // another manager exists, so only the owner rule applies

      const leave = await call(owner, 'POST', '/api/members/leave', {});
      expect(leave.statusCode).toBe(409);
      expect(leave.json().error).toMatch(/needs an owner/);

      const coOwner = await addUser(app, owner.orgId, 'owner');
      // With two owners, one may demote the other, but not the last one.
      expect((await call(coOwner, 'PATCH', `/api/members/${owner.userId}`, { role: 'admin' })).statusCode).toBe(200);
      expect((await call(coOwner, 'POST', '/api/members/leave', {})).statusCode).toBe(409);
    });
  });

  it('migration 020 gives every workspace without an owner one: its longest-standing active admin', async () => {
    const sql = readFileSync(path.join(__dirname, '../../db/migrations/020_organization_owners.sql'), 'utf8');
    const promote = sql.slice(sql.indexOf('UPDATE users'));

    // As before owners existed: the creator is an admin, a later admin, and a removed earlier admin.
    const founder = await registerOrg(app);
    await db.query("UPDATE users SET role = 'admin', created_at = NOW() - interval '2 days' WHERE id = $1", [founder.userId]);
    const removed = await addUser(app, founder.orgId, 'admin');
    await db.query("UPDATE users SET created_at = NOW() - interval '3 days', deactivated_at = NOW() WHERE id = $1", [removed.userId]);
    const later = await addUser(app, founder.orgId, 'admin');
    // A workspace that already has an owner keeps its roles.
    const owned = await registerOrg(app);
    const ownedAdmin = await addUser(app, owned.orgId, 'admin');

    await db.query(promote);

    expect(await roleOf(founder.userId)).toBe('owner');
    expect(await roleOf(later.userId)).toBe('admin');
    expect(await roleOf(removed.userId)).toBe('admin');
    expect(await roleOf(ownedAdmin.userId)).toBe('admin');
  });

  describe('transferring ownership', () => {
    let owner: Actor;
    let member: Actor;

    beforeEach(async () => {
      owner = await registerOrg(app);
      member = await addUser(app, owner.orgId, 'member');
    });

    it('makes the member the owner and the previous owner an admin, in one step, and audits it', async () => {
      const res = await call(owner, 'POST', `/api/members/${member.userId}/transfer-ownership`, {});

      expect(res.statusCode).toBe(200);
      expect(await roleOf(member.userId)).toBe('owner');
      expect(await roleOf(owner.userId)).toBe('admin');
      expect(await row('SELECT user_id, metadata FROM activity_log WHERE entity_id = $1 AND action = $2', [member.userId, 'ownership_transferred']))
        .toEqual({ user_id: owner.userId, metadata: { from_role: 'member' } });

      // The former owner can now leave: the organization still has an owner.
      expect((await call(owner, 'POST', '/api/members/leave', {})).statusCode).toBe(200);
    });

    it('is only for owners, not to yourself, and only to members of your own organization', async () => {
      const admin = await addUser(app, owner.orgId, 'admin');
      expect((await call(admin, 'POST', `/api/members/${member.userId}/transfer-ownership`, {})).statusCode).toBe(403);
      expect((await call(owner, 'POST', `/api/members/${owner.userId}/transfer-ownership`, {})).statusCode).toBe(400);

      const outsider = await registerOrg(app);
      expect((await call(owner, 'POST', `/api/members/${outsider.userId}/transfer-ownership`, {})).statusCode).toBe(404);
      expect(await roleOf(outsider.userId)).toBe('owner');
      expect(await roleOf(owner.userId)).toBe('owner'); // nothing changed
    });
  });

  describe('settings', () => {
    it('shows the organization to every member and lets admins rename it, audited', async () => {
      const owner = await registerOrg(app);
      const viewer = await addUser(app, owner.orgId, 'viewer');
      const member = await addUser(app, owner.orgId, 'member');
      const admin = await addUser(app, owner.orgId, 'admin');

      const got = await call(viewer, 'GET', '/api/organization');
      expect(got.statusCode).toBe(200);
      expect(Object.keys(got.json()).sort()).toEqual(['created_at', 'id', 'name', 'slug', 'updated_at']);
      expect(got.json().id).toBe(owner.orgId);

      expect((await call(member, 'PATCH', '/api/organization', { name: 'Nope' })).statusCode).toBe(403);
      expect((await call(admin, 'PATCH', '/api/organization', { name: '   ' })).statusCode).toBe(400);
      expect((await call(admin, 'PATCH', '/api/organization', { name: 'x', slug: 'other' })).statusCode).toBe(400);

      const renamed = await call(admin, 'PATCH', '/api/organization', { name: '  Acme Labs ' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ name: 'Acme Labs', slug: await slugOf(owner.orgId) });
      expect(await row('SELECT user_id, metadata FROM activity_log WHERE entity_id = $1 AND action = $2', [owner.orgId, 'renamed']))
        .toMatchObject({ user_id: admin.userId, metadata: { to: 'Acme Labs' } });
    });
  });

  describe('deleting the organization', () => {
    let owner: Actor;
    let slug: string;

    beforeEach(async () => {
      owner = await registerOrg(app);
      slug = await slugOf(owner.orgId);
    });

    const remove = (actor: Actor, body: object) => call(actor, 'DELETE', '/api/organization', body);

    it('is only for owners, and needs the exact slug and the owner\'s password', async () => {
      const admin = await addUser(app, owner.orgId, 'admin');
      expect((await remove(admin, { confirm_slug: slug, password: 'password123' })).statusCode).toBe(403);
      expect((await remove(owner, { confirm_slug: 'wrong', password: 'password123' })).statusCode).toBe(400);
      expect((await remove(owner, { confirm_slug: slug, password: 'not-my-password' })).statusCode).toBe(403);
      expect((await remove(owner, { password: 'password123' })).statusCode).toBe(400);
      expect(await row('SELECT id FROM organizations WHERE id = $1', [owner.orgId])).toBeDefined();
    });

    it('deletes everything in it, signs everyone out, frees the emails, and leaves other organizations alone', async () => {
      const member = await addUser(app, owner.orgId, 'member');
      const project = await createProject(app, owner);
      const task = await createTask(app, owner, project.id, { title: 'Doomed' });
      expect((await call(owner, 'POST', `/api/projects/${project.id}/tasks/${task.id}/comments`, { body: 'Bye' })).statusCode).toBe(201);
      expect((await call(owner, 'POST', '/api/labels', { name: `L-${unique()}`, color: 'blue' })).statusCode).toBe(201);

      const other = await registerOrg(app);
      const kept = await createProject(app, other);

      const res = await remove(owner, { confirm_slug: ` ${slug} `, password: 'password123' });
      expect(res.statusCode).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/auth_token=;/);

      for (const table of ['organizations', 'users', 'projects', 'tasks', 'task_comments', 'labels', 'activity_log', 'notifications', 'organization_invites']) {
        const column = table === 'organizations' ? 'id' : 'org_id';
        const rows = await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [owner.orgId]);
        expect(rows, table).toHaveLength(0);
      }

      // Every member's session ends; the other organization is untouched.
      expect((await call(member, 'GET', '/api/projects')).statusCode).toBe(401);
      expect((await call(owner, 'GET', '/api/auth/me')).statusCode).toBe(401);
      expect((await call(other, 'GET', `/api/projects/${kept.id}`)).statusCode).toBe(200);

      // The owner's email can sign up again.
      const again = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { org_name: 'Second try', org_slug: `again-${unique()}`, email: owner.email, password: 'password123', name: 'Again' },
      });
      expect(again.statusCode).toBe(201);
    });
  });

  describe('declining an invite', () => {
    it('stops the link, shows admins the answer, and a new invite clears it', async () => {
      const owner = await registerOrg(app);
      const email = `invitee-${unique()}@example.com`;
      const sent = await call(owner, 'POST', '/api/invites', { email });
      const job = await waitForJob((j) => j.name === 'invite_created' && j.data.invite_id === sent.json().id);
      const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });

      expect((await post('/api/invites/decline', { token: job.data.token })).statusCode).toBe(204);
      expect((await post('/api/invites/decline', { token: job.data.token })).statusCode).toBe(404);
      expect((await post('/api/invites/lookup', { token: job.data.token })).statusCode).toBe(404);
      expect((await post('/api/invites/accept', { token: job.data.token, name: 'No', password: 'password123' })).statusCode).toBe(404);

      const listed = (await call(owner, 'GET', '/api/invites')).json();
      expect(listed[0]).toMatchObject({ email, declined_at: expect.any(String) });

      const resent = await call(owner, 'POST', '/api/invites', { email });
      expect(resent.json().declined_at).toBeNull();
      const second = await waitForJob((j) => j.name === 'invite_created' && j.data.invite_id === sent.json().id && j.data.token !== job.data.token);
      expect((await post('/api/invites/lookup', { token: second.data.token })).statusCode).toBe(200);
    });
  });
});
