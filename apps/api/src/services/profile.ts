import type { FastifyBaseLogger } from 'fastify';
import * as profiles from '../data/profile';
import type { TenantScope } from '../data/scope';
import { ForbiddenError, NotFoundError } from '../domain/errors';
import { hashPassword, verifyPassword } from '../security/passwords';
import { auditBestEffort, type RequestOrigin } from '../security/audit';

/** The caller's own account: their name, and their password. */

const userNotFound = () => new NotFoundError('User not found');

export async function getProfile(scope: TenantScope) {
  const profile = await profiles.findOwn(scope);
  if (!profile) throw userNotFound();
  return profile;
}

export interface ProfileUpdate {
  name?: string;
  /** The new password. Requires `currentPassword`. */
  password?: string;
  currentPassword?: string;
}

/**
 * Change the caller's name and/or password. A new password needs the current one, so a session that
 * was left open or stolen cannot be used to lock the owner out of their account. A wrong current
 * password changes nothing (not even the name) and is recorded in the security audit log.
 *
 * Returns the updated account; with a new password every session has ended and the caller needs a new
 * one with `token_version`.
 */
export async function updateProfile(
  scope: TenantScope,
  update: ProfileUpdate,
  origin: RequestOrigin,
  log: FastifyBaseLogger
) {
  if (update.password !== undefined) {
    const current = await profiles.ownPasswordHash(scope);
    if (current === undefined) throw userNotFound();
    if (!(await verifyPassword(update.currentPassword ?? '', current))) {
      await auditBestEffort(origin, {
        orgId: scope.orgId, actorId: scope.userId, action: 'auth.password_change_failed', targetType: 'user', targetId: scope.userId,
      }, log);
      throw new ForbiddenError('Your current password is incorrect.');
    }
  }

  const user = await profiles.updateOwn(scope, {
    name: update.name,
    passwordHash: update.password === undefined ? undefined : await hashPassword(update.password),
  });
  if (!user) throw userNotFound();

  if (update.password !== undefined) {
    log.info({ event: 'password_changed' }, 'Password changed; other sessions revoked');
    await auditBestEffort(origin, {
      orgId: user.org_id, actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id,
    }, log);
  }
  return user;
}
