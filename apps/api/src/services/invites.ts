import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';
import { enqueue } from '../jobs/enqueue';
import { hashPassword } from '../security/passwords';
import { generateToken, hashToken } from '../security/tokens';
import { audit, auditBestEffort, type RequestOrigin } from '../security/audit';
import type { Role } from '../plugins/auth';
import { ConflictError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as invites from '../data/invites';
import type { Invite } from '../data/invites';
import type { TenantScope } from '../data/scope';

/**
 * Inviting people into an organization. Admins create, list and revoke invites; the invitee, who has
 * no account yet, looks one up, declines or accepts it with the emailed token.
 */

export const INVITE_TTL_DAYS = 7;
/**
 * Most invites an organization holds at once, pending, expired and declined together (all are listed
 * until revoked or accepted). Keeps the list bounded without paging it.
 */
export const MAX_INVITES_PER_ORG = 500;

const inviteGone = () => new NotFoundError('Invite not found or expired');

type InviteAction = 'created' | 'revoked' | 'accepted';

/** The activity feed and the security audit log both record invite changes. */
async function record(client: PoolClient, scope: TenantScope, origin: RequestOrigin, inviteId: string, action: InviteAction, metadata: Record<string, unknown> = {}) {
  await logActivity(client, scope, 'invite', inviteId, action, metadata);
  await audit(client, origin, { orgId: scope.orgId, actorId: scope.userId, action: `invite.${action}`, targetType: 'invite', targetId: inviteId, metadata });
}

/**
 * Invite `rawEmail` and email them a link. The raw token goes only into the job that emails it (removed
 * from Redis once done, never logged); the database keeps its hash. Best effort: if the job cannot be
 * queued, the invite exists and can be re-sent.
 */
export async function createInvite(
  scope: TenantScope,
  rawEmail: string,
  role: string,
  origin: RequestOrigin,
  log: Pick<FastifyBaseLogger, 'warn'>
): Promise<Invite> {
  const email = rawEmail.toLowerCase().trim();
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await withTransaction(async (client) => {
    if (await invites.isMemberEmail(client, scope, email)) {
      throw new ConflictError('This person is already a member of your organization');
    }
    if ((await invites.lockAndCountOthers(client, scope, email)) >= MAX_INVITES_PER_ORG) {
      throw new ConflictError(`An organization can have at most ${MAX_INVITES_PER_ORG} invites; revoke expired or declined ones first`);
    }
    const created = await invites.upsert(client, scope, { email, tokenHash, role, expiresAt });
    await record(client, scope, origin, created.id, 'created', { role });
    return created;
  });

  await enqueue(
    'invite_created',
    { invite_id: invite.id, org_id: scope.orgId, token, request_id: origin.requestId },
    { removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } },
    log
  );
  return invite;
}

export const listInvites = (scope: TenantScope) => invites.list(scope);

export async function revokeInvite(scope: TenantScope, id: string, origin: RequestOrigin): Promise<void> {
  await withTransaction(async (client) => {
    if (!(await invites.revoke(client, scope, id))) throw new NotFoundError('Invite not found');
    await record(client, scope, origin, id, 'revoked');
  });
}

export async function lookupInvite(token: string) {
  const invite = await invites.describeByToken(hashToken(token));
  if (!invite) throw inviteGone();
  return invite;
}

/**
 * The invitee says no. The link stops working; the invite stays, marked, so the organization's admins
 * see the answer instead of a link that is never used.
 */
export async function declineInvite(token: string, origin: RequestOrigin, log: FastifyBaseLogger): Promise<void> {
  const invite = await invites.declineByToken(hashToken(token));
  if (!invite) throw inviteGone();
  await auditBestEffort(
    origin,
    { orgId: invite.org_id, actorId: null, action: 'invite.declined', targetType: 'invite', targetId: invite.id, metadata: { email: invite.email } },
    log
  );
}

/**
 * Create the invitee's account in the inviting organization, with the invited role and email, and
 * consume the invite. Returns the claims for their new session.
 */
export async function acceptInvite(token: string, name: string, password: string, origin: RequestOrigin) {
  const emailTaken = () => new ConflictError('An account with this email already exists. Sign in instead.');
  try {
    return await withTransaction(async (client) => {
      const invite = await invites.lockByToken(client, hashToken(token));
      if (!invite) throw inviteGone();
      if (await invites.emailRegistered(client, invite.email)) throw emailTaken();

      const userId = await invites.createUserFromInvite(client, invite, name, await hashPassword(password));
      await invites.consume(client, invite);

      // From here on the new user acts within the inviting organization.
      const scope: TenantScope = { orgId: invite.org_id, userId, role: invite.role as Role };
      await record(client, scope, origin, invite.id, 'accepted', { role: invite.role });
      return { user_id: userId, org_id: invite.org_id, role: invite.role, tv: 0 };
    });
  } catch (err) {
    // 23505: the email was registered between the check and the insert.
    if ((err as { code?: string })?.code === '23505') throw emailTaken();
    throw err;
  }
}
