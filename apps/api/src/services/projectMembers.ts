import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { hasMinRole } from '../plugins/auth';
import { unassignWithoutAccess } from '../security/projectAccess';
import { audit, type RequestOrigin } from '../security/audit';
import { announceAccessChange } from '../realtime/announce';
import { BadRequestError, ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as members from '../data/members';
import * as projectMembers from '../data/projectMembers';
import type { TenantScope } from '../data/scope';
import { boardCacheKey } from './tasks';

/**
 * People of a project. Membership decides who sees a PRIVATE project (plus admins and owners, who see
 * every project). It is kept for workspace projects too, so making one private keeps the people
 * already added. The project gate (app.ts) has already answered 404 to anyone who cannot see it.
 */

export const listProjectPeople = (scope: TenantScope, projectId: string) => projectMembers.listPeople(scope, projectId);

/** Add someone from the organization (members and up). Returns whether they were newly added. */
export async function addProjectMember(scope: TenantScope, projectId: string, userId: string, origin: RequestOrigin): Promise<boolean> {
  const added = await withTransaction(async (client) => {
    const user = await members.findActive(scope, userId, client);
    if (!user) throw new BadRequestError('Only members of your organization can be added');

    const isNew = await projectMembers.add(client, scope, projectId, userId);
    if (isNew) {
      const metadata = { user_id: userId, name: user.name };
      await logActivity(client, scope, 'project', projectId, 'member_added', metadata);
      await audit(client, origin, {
        orgId: scope.orgId, actorId: scope.userId, action: 'project.member_added', targetType: 'project', targetId: projectId, metadata,
      });
    }
    return isNew;
  });

  if (added) await announceAccessChange(scope.orgId, projectId);
  return added;
}

/**
 * Remove someone (members and up), or leave yourself (anyone). If they can no longer see the project,
 * their tasks in it are unassigned.
 */
export async function removeProjectMember(scope: TenantScope, projectId: string, userId: string, origin: RequestOrigin): Promise<void> {
  if (userId !== scope.userId && !hasMinRole(scope.role, 'member')) {
    throw new ForbiddenError('Forbidden: Insufficient permissions');
  }

  const unassigned = await withTransaction(async (client) => {
    const name = await projectMembers.remove(client, scope, projectId, userId);
    if (name === null) throw new NotFoundError('Not a member of this project');
    const count = await unassignWithoutAccess(client, scope.orgId, projectId);
    const metadata = { user_id: userId, name, unassigned: count };
    await logActivity(client, scope, 'project', projectId, 'member_removed', metadata);
    await audit(client, origin, {
      orgId: scope.orgId, actorId: scope.userId, action: 'project.member_removed', targetType: 'project', targetId: projectId, metadata,
    });
    return count;
  });

  if (unassigned > 0) await cache.del(boardCacheKey(scope.orgId, projectId));
  await announceAccessChange(scope.orgId, projectId);
}
