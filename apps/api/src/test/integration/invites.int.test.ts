import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { MAX_INVITES_PER_ORG } from '../../services/invites';
import { registerOrg, row, startApp, type Actor, type App } from './harness';

/** The invite list stays bounded: an organization holds at most MAX_INVITES_PER_ORG invites. */
describe('invite limit (real Postgres)', () => {
  let app: App;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const invite = (admin: Actor, email: string) => app.inject({ method: 'POST', url: '/api/invites', headers: admin.auth, payload: { email } });

  /** Fill the organization with invites (expired ones count: they are listed until revoked). */
  async function fill(orgId: string) {
    await db.query(
      `INSERT INTO organization_invites (org_id, email, token_hash, role, expires_at)
       SELECT $1::uuid, 'invitee' || i || '@example.com', md5($1::text || i), 'member', NOW() - interval '1 day'
         FROM generate_series(1, $2::int) AS i`,
      [orgId, MAX_INVITES_PER_ORG]
    );
  }

  it('refuses a new invite at the limit, but still re-sends an existing one', async () => {
    const admin = await registerOrg(app);
    await fill(admin.orgId);

    const extra = await invite(admin, 'one.more@example.com');
    expect(extra.statusCode).toBe(409);
    expect(extra.json().error).toMatch(new RegExp(`at most ${MAX_INVITES_PER_ORG} invites`));
    expect(await row('SELECT 1 FROM organization_invites WHERE email = $1', ['one.more@example.com'])).toBeUndefined();

    // Re-inviting someone replaces their invite, so it does not add one.
    expect((await invite(admin, 'invitee7@example.com')).statusCode).toBe(201);

    // Revoking one makes room.
    const { id } = (await row<{ id: string }>('SELECT id FROM organization_invites WHERE email = $1', ['invitee1@example.com']))!;
    expect((await app.inject({ method: 'DELETE', url: `/api/invites/${id}`, headers: admin.auth })).statusCode).toBe(204);
    expect((await invite(admin, 'one.more@example.com')).statusCode).toBe(201);
  });

  it("counts each organization's invites separately", async () => {
    const full = await registerOrg(app);
    await fill(full.orgId);
    const other = await registerOrg(app);

    expect((await invite(other, 'someone@example.com')).statusCode).toBe(201);
  });
});
