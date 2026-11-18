import type { Role } from '../plugins/auth';
import type { Viewer } from '../security/projectAccess';

/**
 * Who is acting, and in which organization: the tenant boundary of every data-access call.
 *
 * It is built only from the verified session (`scopeOf(request.user)`), never from a request body,
 * query string or path parameter. Repository functions in `data/` take a scope and filter every
 * statement by `scope.orgId`, so tenant isolation is enforced in one layer rather than per route
 * handler (docs/security-model.md).
 */
export interface TenantScope {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
}

/** The scope of an authenticated request: `scopeOf(request.user)`. */
export function scopeOf(user: { org_id: string; user_id: string; role: string }): TenantScope {
  return Object.freeze({ orgId: user.org_id, userId: user.user_id, role: user.role as Role });
}

/** The scope as security/projectAccess.ts expects it. */
export const viewerOf = (scope: TenantScope): Viewer => ({ user_id: scope.userId, role: scope.role });
