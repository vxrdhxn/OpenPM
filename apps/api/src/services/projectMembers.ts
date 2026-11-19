import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { hasMinRole } from '../plugins/auth';
import { unassignWithoutAccess } from '../security/projectAccess';
import { audit, type RequestOrigin } from '../security/audit';
import { announceAccessChange } from '../realtime/announce';
import { announce, notify } from '../notifications/notify';
import { BadRequestError, ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as members from '../data/members';
import * as projectMembers from '../data/projectMembers';
import * as projects from '../data/projects';
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
  let notified: string[] = [];
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
      // Tied to the project: it shows while they can see it, and leads there.
      const project = await projects.nameOf(client, scope, projectId);
      notified = await notify(client, {
        orgId: scope.orgId, actorId: scope.userId, type: 'project_added', recipients: [userId], projectId, data: { project_name: project },
      });
    }
    return isNew;
  });

  if (added) {
    await announceAccessChange(scope.orgId, projectId);
    await announce(scope.orgId, notified);
  }
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

  let notified: string[] = [];
  const unassigned = await withTransaction(async (client) => {
    const project = await projects.nameOf(client, scope, projectId);
    const name = await projectMembers.remove(client, scope, projectId, userId);
    if (name === null) throw new NotFoundError('Not a member of this project');
    const count = await unassignWithoutAccess(client, scope.orgId, projectId);
    const metadata = { user_id: userId, name, unassigned: count };
    await logActivity(client, scope, 'project', projectId, 'member_removed', metadata);
    await audit(client, origin, {
      orgId: scope.orgId, actorId: scope.userId, action: 'project.member_removed', targetType: 'project', targetId: projectId, metadata,
    });
    // Not tied to the project (they may no longer see it), so it names it instead. Leaving yourself
    // notifies nobody: people are never notified about their own actions.
    notified = await notify(client, {
      orgId: scope.orgId, actorId: scope.userId, type: 'project_removed', recipients: [userId], data: { project_name: project },
    });
    return count;
  });

  if (unassigned > 0) await cache.del(boardCacheKey(scope.orgId, projectId));
  await announceAccessChange(scope.orgId, projectId);
  await announce(scope.orgId, notified);
}
