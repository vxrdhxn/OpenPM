import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
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
import * as signups from '../data/signups';
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

/** Sign-up links work this long. */
export const SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Someone who already has an account is told about a sign-up with their address at most this often. */
const EXISTING_ACCOUNT_NOTICE_MS = 60 * 60 * 1000;

export const SLUG_TAKEN = 'That organization URL is taken. Try another one.';

async function createWorkspace(
  client: PoolClient,
  workspace: { orgName: string; slug: string; email: string; passwordHash: string; name: string },
  origin: RequestOrigin,
  verified: boolean
): Promise<Required<SessionClaims>> {
  const orgId = await accounts.createOrganization(client, workspace.orgName, workspace.slug);
  const userId = await accounts.createUser(client, { orgId, email: workspace.email, passwordHash: workspace.passwordHash, name: workspace.name, role: 'owner' });
  await audit(client, origin, {
    orgId, actorId: userId, action: 'auth.registered', targetType: 'organization', targetId: orgId, metadata: { slug: workspace.slug, email_verified: verified },
  });
  return { user_id: userId, org_id: orgId, role: 'owner', tv: 0 };
}

/**
 * Create an organization and its owner at once (sign-up without email verification). A taken slug
 * and a taken email get the same answer, so the response does not say whether an email is
 * registered, but registration still fails where it would otherwise succeed. With verification on,
 * `requestSignup` closes that gap. (The route is rate-limited.)
 */
export async function register(input: Registration, origin: RequestOrigin): Promise<Required<SessionClaims>> {
  const email = input.email.toLowerCase().trim();
  const conflict = () => {
    authFailuresTotal.inc({ reason: 'register_conflict' });
    return new ConflictError(REGISTER_CONFLICT);
  };

  return withTransaction(async (client) => {
    if (await accounts.slugTaken(client, input.org_slug)) throw conflict();
    if (await accounts.emailTaken(client, email)) throw conflict();
    const passwordHash = await hashPassword(input.password);
    return createWorkspace(client, { orgName: input.org_name, slug: input.org_slug, email, passwordHash, name: input.name }, origin, false);
  });
}

/**
 * The part of a verified sign-up the caller waits for: the organization URL must be free. That says
 * nothing about any email address, so it can be answered directly. Everything that depends on the
 * email is `sendSignupLink`, which the route runs after replying.
 */
export async function checkSignupSlug(slug: string): Promise<void> {
  if (await accounts.slugTakenNow(slug)) {
    authFailuresTotal.inc({ reason: 'register_conflict' });
    throw new ConflictError(SLUG_TAKEN);
  }
}

/**
 * Verify-by-email sign-up, step 1 (docs/signup.md). Runs after the reply, so whether the address
 * is registered changes neither the answer nor its timing.
 *
 * - A new address: the sign-up is stored with a hashed token and the link is emailed. Nothing is
 *   created until it is opened.
 * - A registered address: no sign-up; its owner gets an email saying someone tried to create a
 *   workspace with it (at most one an hour), with links to sign in or reset the password.
 */
export async function sendSignupLink(input: Registration, requestId: string): Promise<void> {
  const email = input.email.toLowerCase().trim();
  const existing = await accounts.findActiveByEmail(email);
  if (existing) {
    const hour = Math.floor(Date.now() / EXISTING_ACCOUNT_NOTICE_MS);
    await enqueue(
      'signup_existing_account',
      { user_id: existing.id, org_id: existing.org_id, request_id: requestId },
      // One job id per user per hour: repeated sign-ups cannot flood their inbox.
      { jobId: `signup-existing-${existing.id}-${hour}`, removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } }
    );
    return;
  }

  const { token, tokenHash } = generateToken();
  const passwordHash = await hashPassword(input.password);
  const signupId = await withTransaction((client) =>
    signups.replace(client, {
      email, tokenHash, orgName: input.org_name, orgSlug: input.org_slug, name: input.name, passwordHash,
      expiresAt: new Date(Date.now() + SIGNUP_TOKEN_TTL_MS),
    })
  );
  await enqueue(
    'signup_verification',
    { signup_id: signupId, token, request_id: requestId },
    { removeOnComplete: true, removeOnFail: { age: SIGNUP_TOKEN_TTL_MS / 1000 } }
  );
}

/**
 * Verify-by-email sign-up, step 2: the emailed link was opened. Creates the organization and its
 * owner from the stored request and consumes it. If the URL or the address was taken in the
 * meantime, the request is dropped and the person has to sign up again (or sign in).
 */
export async function completeSignup(token: string, origin: RequestOrigin): Promise<Required<SessionClaims>> {
  const outcome = await withTransaction(async (client): Promise<{ ok: true; claims: Required<SessionClaims> } | { ok: false; error: string }> => {
    const request = await signups.lockByToken(client, hashToken(token));
    if (!request) throw new BadRequestError('This sign-up link is invalid or has expired. Sign up again.');
    await signups.remove(client, request.id);

    if (await accounts.slugTaken(client, request.org_slug)) return { ok: false, error: SLUG_TAKEN_SINCE };
    if (await accounts.emailTaken(client, request.email)) return { ok: false, error: REGISTER_CONFLICT };
    const claims = await createWorkspace(
      client,
      { orgName: request.org_name, slug: request.org_slug, email: request.email, passwordHash: request.password_hash, name: request.name },
      origin,
      true
    );
    return { ok: true, claims };
  });
  // The consumed request stays deleted: the conflict is answered after the commit.
  if (!outcome.ok) {
    authFailuresTotal.inc({ reason: 'register_conflict' });
    throw new ConflictError(outcome.error);
  }
  return outcome.claims;
}

const SLUG_TAKEN_SINCE = 'That organization URL was taken after you signed up. Sign up again with another one.';

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
