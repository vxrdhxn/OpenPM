import type { FastifyBaseLogger } from 'fastify';
import { withTransaction } from '../db/transaction';
import { enqueue } from '../jobs/enqueue';
import { authFailuresTotal } from '../metrics';
import { revokeSessions } from '../plugins/session';
import type { SessionClaims } from '../plugins/auth';
import { hashPassword, verifyPassword } from '../security/passwords';
import { generateToken, hashToken } from '../security/tokens';
import { audit, auditBestEffort, type RequestOrigin } from '../security/audit';
import { AppError, BadRequestError, ConflictError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as accounts from '../data/accounts';
import type { TenantScope } from '../data/scope';

/**
 * Registration, sign-in and password reset. Every answer here is shaped so that nothing observable
 * (response, status, timing, metrics, logs) says whether an email address has an account.
 */

export const REGISTER_CONFLICT =
  'Could not create the account. Try a different organization URL, or sign in if you already have an account.';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface Registration {
  org_name: string;
  org_slug: string;
  email: string;
  password: string;
  name: string;
}

/**
 * Create an organization and its owner (only owners can transfer or delete it). A taken slug and a
 * taken email get the same answer, so the response does not say whether an email is registered.
 * (Registration still fails where it would otherwise succeed; fully hiding that needs a verify-by-email
 * sign-up. The route is rate-limited.)
 */
export async function register(input: Registration, origin: RequestOrigin): Promise<Required<SessionClaims>> {
  const email = input.email.toLowerCase().trim();
  const conflict = () => {
    authFailuresTotal.inc({ reason: 'register_conflict' });
    return new ConflictError(REGISTER_CONFLICT);
  };

  const { orgId, userId } = await withTransaction(async (client) => {
    if (await accounts.slugTaken(client, input.org_slug)) throw conflict();
    if (await accounts.emailTaken(client, email)) throw conflict();

    const passwordHash = await hashPassword(input.password);
    const orgId = await accounts.createOrganization(client, input.org_name, input.org_slug);
    const userId = await accounts.createUser(client, { orgId, email, passwordHash, name: input.name, role: 'owner' });
    await audit(client, origin, {
      orgId, actorId: userId, action: 'auth.registered', targetType: 'organization', targetId: orgId, metadata: { slug: input.org_slug },
    });
    return { orgId, userId };
  });
  return { user_id: userId, org_id: orgId, role: 'owner', tv: 0 };
}

/**
 * Check credentials and return the claims for a new session. One answer (401) and one metric/log
 * reason for both "no such user" and "wrong password"; the email address is never recorded.
 */
export async function login(rawEmail: string, password: string, origin: RequestOrigin, log: FastifyBaseLogger): Promise<Required<SessionClaims>> {
  const user = await accounts.findForLogin(rawEmail.toLowerCase().trim());

  // Always one full bcrypt comparison (against a dummy hash for an unknown email), so the response
  // time does not reveal whether the account exists.
  const match = await verifyPassword(password, user?.password_hash);

  if (!user || !match) {
    // A wrong password for a real account is audited for that workspace's admins. Not awaited: the
    // extra write must not make "account exists" answer slower than "no such account".
    if (user) {
      void auditBestEffort(origin, { orgId: user.org_id, actorId: null, action: 'auth.login_failed', targetType: 'user', targetId: user.id }, log);
    }
    authFailuresTotal.inc({ reason: 'bad_credentials' });
    log.warn({ event: 'login_failed', reason: 'bad_credentials' }, 'Login failed');
    throw new AppError(401, 'Invalid credentials');
  }

  await auditBestEffort(origin, { orgId: user.org_id, actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id }, log);
  return { user_id: user.id, org_id: user.org_id, role: user.role, tv: user.token_version ?? 0 };
}

/**
 * Create a reset token for the user with this email (if any) and queue the email that delivers it.
 * Earlier links for the user are invalidated, so only the newest one works. The database keeps only
 * the token's hash; the raw token goes into the job, which is removed from Redis once it completes.
 */
export async function issuePasswordResetLink(email: string, requestId: string, origin: RequestOrigin | null = null): Promise<void> {
  const { token, tokenHash } = generateToken();

  const userId = await withTransaction(async (client) => {
    const user = await accounts.findByEmail(client, email);
    if (!user) return null;

    await audit(client, origin, { orgId: user.org_id, actorId: null, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id });
    await accounts.replaceResetToken(client, user.id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS));
    return user.id;
  });
  if (!userId) return;

  await enqueue(
    'password_reset_requested',
    { user_id: userId, token, request_id: requestId },
    { removeOnComplete: true, removeOnFail: { age: RESET_TOKEN_TTL_MS / 1000 } }
  );
}

/** Consume a reset token and set a new password. Whoever had the old password (or a stolen session) is signed out everywhere. */
export async function resetPassword(token: string, password: string, origin: RequestOrigin): Promise<void> {
  await withTransaction(async (client) => {
    const owner = await accounts.lockResetToken(client, hashToken(token));
    if (!owner) throw new BadRequestError('Invalid or expired reset token');

    await accounts.setPassword(client, owner.user_id, await hashPassword(password));
    await revokeSessions(owner.user_id, client);
    // Consumes this link and any other outstanding ones for the user.
    await accounts.deleteResetTokens(client, owner.user_id);

    const scope: TenantScope = { orgId: owner.org_id, userId: owner.user_id, role: 'viewer' }; // role is not used for logging
    await logActivity(client, scope, 'user', owner.user_id, 'password_reset');
    await audit(client, origin, { orgId: owner.org_id, actorId: null, action: 'auth.password_reset', targetType: 'user', targetId: owner.user_id });
  });
}
