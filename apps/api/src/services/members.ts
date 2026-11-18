import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { checkMemberChange, DENIAL_MESSAGES, isManager } from '../security/memberPolicy';
import { audit, type RequestOrigin } from '../security/audit';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as members from '../data/members';
import type { Member } from '../data/members';
import type { TenantScope } from '../data/scope';
import { boardCacheKey } from './tasks';

/**
 * Organization membership: role changes, removal, leaving and ownership transfer. Every change locks
 * the organization first and keeps it run: it always has an owner and at least one admin or owner.
 */

const memberNotFound = () => new NotFoundError('Member not found');

/** Losing `member` as an owner/manager (demotion to `newRole`, removal or leaving) must leave the org run. */
async function assertStillRun(client: PoolClient, scope: TenantScope, member: { id: string; role: string }, newRole?: string) {
  if (member.role === 'owner' && newRole !== 'owner' && !(await members.anotherHasRole(client, scope, member.id, ['owner']))) {
    throw new ConflictError('The organization needs an owner. Transfer ownership to another member first.');
  }
  if (isManager(member.role) && !(newRole && isManager(newRole)) && !(await members.anotherHasRole(client, scope, member.id, ['owner', 'admin']))) {
    throw new ConflictError('The organization needs at least one admin. Make another member an admin first.');
  }
}

type MemberAction = 'role_changed' | 'removed' | 'left' | 'ownership_transferred';

/** The activity feed and the security audit log both record membership changes. */
async function record(client: PoolClient, scope: TenantScope, origin: RequestOrigin, targetId: string, action: MemberAction, metadata: Record<string, unknown>) {
  await logActivity(client, scope, 'user', targetId, action, metadata);
  await audit(client, origin, { orgId: scope.orgId, actorId: scope.userId, action: `member.${action}`, targetType: 'user', targetId, metadata });
}

const invalidateBoards = (orgId: string, projectIds: string[]) => Promise.all(projectIds.map((id) => cache.del(boardCacheKey(orgId, id))));

export const listMembers = (scope: TenantScope) => members.listActive(scope);

/** Change a member's role (admins, within the limits of security/memberPolicy.ts). */
export async function changeRole(scope: TenantScope, userId: string, role: string, origin: RequestOrigin): Promise<Member | Pick<Member, 'id' | 'name' | 'role'>> {
  return withTransaction(async (client) => {
    await members.lockOrganization(client, scope);
    const target = await members.lockActive(client, scope, userId);
    if (!target) throw memberNotFound();

    const denial = checkMemberChange({ id: scope.userId, role: scope.role }, target, role);
    if (denial) throw new ForbiddenError(DENIAL_MESSAGES[denial]);

    if (target.role === role) return target;
    await assertStillRun(client, scope, target, role);

    // No session revocation needed: every request reads the role from the database (plugins/auth.ts).
    const updated = await members.setRole(client, scope, userId, role);
    await record(client, scope, origin, userId, 'role_changed', { from: target.role, to: role });
    return updated;
  });
}

/** Remove a member from the organization (admins, within the limits of security/memberPolicy.ts). */
export async function removeMember(scope: TenantScope, userId: string, origin: RequestOrigin): Promise<void> {
  const boards = await withTransaction(async (client) => {
    await members.lockOrganization(client, scope);
    const target = await members.lockActive(client, scope, userId);
    if (!target) throw memberNotFound();

    const denial = checkMemberChange({ id: scope.userId, role: scope.role }, target);
    if (denial) throw new ForbiddenError(DENIAL_MESSAGES[denial]);
    await assertStillRun(client, scope, target);

    const changed = await members.deactivate(client, scope, userId);
    await record(client, scope, origin, userId, 'removed', { role: target.role, name: target.name });
    return changed;
  });
  await invalidateBoards(scope.orgId, boards);
}

/**
 * Make another member the owner and step down to admin, in one step, so the organization is never
 * without an owner and never has one by accident.
 */
export async function transferOwnership(scope: TenantScope, newOwnerId: string, origin: RequestOrigin): Promise<Member[]> {
  return withTransaction(async (client) => {
    await members.lockOrganization(client, scope);
    if (newOwnerId === scope.userId) throw new BadRequestError('You already own this organization.');
    const me = await members.lockActive(client, scope, scope.userId);
    if (!me || me.role !== 'owner') throw new ForbiddenError('Only an owner can transfer ownership.');
    const target = await members.lockActive(client, scope, newOwnerId);
    if (!target) throw memberNotFound();

    const changed = await members.swapOwner(client, scope, newOwnerId);
    await record(client, scope, origin, newOwnerId, 'ownership_transferred', { from_role: target.role });
    return changed;
  });
}

/** Leave the organization yourself (any role, as long as it stays run). */
export async function leave(scope: TenantScope, origin: RequestOrigin): Promise<void> {
  const boards = await withTransaction(async (client) => {
    await members.lockOrganization(client, scope);
    const me = await members.lockActive(client, scope, scope.userId);
    if (!me) throw memberNotFound();
    await assertStillRun(client, scope, me);

    const changed = await members.deactivate(client, scope, scope.userId);
    await record(client, scope, origin, scope.userId, 'left', { role: me.role });
    return changed;
  });
  await invalidateBoards(scope.orgId, boards);
}
