import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { deleteStoredObjects } from '../attachments/cleanup';
import { announceAccessChange } from '../realtime/announce';
import { audit, type RequestOrigin } from '../security/audit';
import { seesAllProjects, unassignWithoutAccess, type Visibility } from '../security/projectAccess';
import { DEFAULT_PAGE_SIZE, type Page } from '../query/pagination';
import { ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as projects from '../data/projects';
import type { ProjectChanges, ProjectListFilter, ProjectListItem, ProjectRow } from '../data/projects';
import type { TenantScope } from '../data/scope';

/**
 * Project use cases. Each one runs its writes in one transaction and does the side effects that
 * must only follow a commit (cache invalidation, live events, file deletion) after it.
 */

const listCacheKey = (orgId: string) => `org:${orgId}:projects`;
const tasksCacheKey = (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}:tasks`;
const LIST_CACHE_SECONDS = 300;

const notFound = () => new NotFoundError('Project not found');

export interface NewProject {
  name: string;
  description?: string;
  visibility?: Visibility;
}

export async function createProject(scope: TenantScope, input: NewProject): Promise<ProjectRow> {
  const visibility = input.visibility ?? 'workspace';

  const created = await withTransaction(async (client) => {
    const project = await projects.insert(client, scope, { ...input, visibility });
    // The creator is a member, so a private project stays theirs (even if they are later demoted).
    await projects.addMember(client, scope, project.id, scope.userId);
    await logActivity(client, scope, 'project', project.id, 'created', { name: input.name, visibility });
    return project;
  });

  await cache.del(listCacheKey(scope.orgId));
  if (visibility === 'private') await announceAccessChange(scope.orgId, created.id);
  return created;
}

/**
 * The projects the scope's user can see. Only the plain first page is cached (it is what the projects
 * page loads), and only for admins and owners: they see every project, so one cached list is right for
 * all of them. Everyone else gets the list filtered for them, straight from Postgres.
 */
export async function listProjects(scope: TenantScope, filter: ProjectListFilter): Promise<Page<ProjectListItem>> {
  const cacheable =
    seesAllProjects(scope.role) && !filter.cursor && !filter.q && !filter.status && filter.limit === DEFAULT_PAGE_SIZE;

  if (cacheable) {
    const cached = await cache.get<Page<ProjectListItem>>(listCacheKey(scope.orgId));
    if (cached) return cached;
  }

  const page = await projects.listVisible(scope, filter);
  if (cacheable) await cache.set(listCacheKey(scope.orgId), page, LIST_CACHE_SECONDS);
  return page;
}

export async function getProject(scope: TenantScope, id: string): Promise<ProjectRow> {
  const project = await projects.findById(scope, id);
  if (!project) throw notFound();
  return project;
}

/**
 * Change a project. Changing its visibility is for admins, owners and whoever created it, so a member
 * cannot hide a shared project from the rest of the team. Making it private keeps it visible to the
 * person who did, and unassigns tasks from people who can no longer see it.
 */
export async function updateProject(
  scope: TenantScope,
  id: string,
  changes: ProjectChanges & { visibility?: Visibility },
  origin: RequestOrigin
): Promise<ProjectRow> {
  let accessChanged = false;
  let unassigned = 0;

  const updated = await withTransaction(async (client) => {
    const current = await projects.lockForUpdate(client, scope, id);
    if (!current) throw notFound();

    accessChanged = changes.visibility !== undefined && changes.visibility !== current.visibility;
    if (accessChanged && !seesAllProjects(scope.role) && current.created_by !== scope.userId) {
      throw new ForbiddenError('Only admins, owners and the project creator can change who sees a project.');
    }

    const project = await projects.update(client, scope, id, changes);
    if (!project) throw notFound();

    if (accessChanged && changes.visibility === 'private') {
      await projects.addMember(client, scope, id, scope.userId);
      unassigned = await unassignWithoutAccess(client, scope.orgId, id);
    }

    await logActivity(client, scope, 'project', id, 'updated', unassigned ? { ...changes, unassigned } : changes);
    if (accessChanged) {
      await audit(client, origin, {
        orgId: scope.orgId,
        actorId: scope.userId,
        action: 'project.visibility_changed',
        targetType: 'project',
        targetId: id,
        metadata: { name: project.name, from: current.visibility, to: changes.visibility, unassigned },
      });
    }
    return project;
  });

  await cache.del(listCacheKey(scope.orgId));
  if (unassigned > 0) await cache.del(tasksCacheKey(scope.orgId, id));
  if (accessChanged) await announceAccessChange(scope.orgId, id);
  return updated;
}

/**
 * Delete a project with its tasks. Their files in object storage are removed after the commit, so a
 * rolled-back delete never loses files that are still referenced; a storage failure is logged, not
 * returned (the project is gone either way).
 */
export async function deleteProject(
  scope: TenantScope,
  id: string,
  origin: RequestOrigin,
  log: Parameters<typeof deleteStoredObjects>[1]
): Promise<void> {
  const orphanedKeys = await withTransaction(async (client) => {
    const keys = await projects.deleteAttachments(client, scope, id);
    const deleted = await projects.remove(client, scope, id);
    if (!deleted) throw notFound(); // the rollback restores the attachment rows

    // activity_log and audit_log rows are not tied to the project, so they survive the delete.
    await logActivity(client, scope, 'project', id, 'deleted', { name: deleted.name });
    await audit(client, origin, {
      orgId: scope.orgId,
      actorId: scope.userId,
      action: 'project.deleted',
      targetType: 'project',
      targetId: id,
      metadata: { name: deleted.name },
    });
    return keys;
  });

  await deleteStoredObjects(orphanedKeys, log);
  await cache.del(listCacheKey(scope.orgId));
}
