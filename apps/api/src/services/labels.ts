import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { BadRequestError, ConflictError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as labels from '../data/labels';
import type { Label, TaskLabel } from '../data/labels';
import type { TenantScope } from '../data/scope';
import { boardCacheKey } from './tasks';

/**
 * The organization's labels. Anyone can see them, members create and edit them, admins delete them
 * (which removes them from every task). Changes publish `labels_changed` so open boards refresh.
 */

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
/** Most labels one organization can have, so the label list and pickers stay bounded. */
export const MAX_LABELS_PER_ORG = 200;
/** Most labels on one task. */
export const MAX_LABELS_PER_TASK = 20;

const labelNotFound = () => new NotFoundError('Label not found');

/** A duplicate name (unique per organization) is a 409, whichever statement hits it. */
async function mapDuplicateName<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') throw new ConflictError('A label with this name already exists');
    throw err;
  }
}

const announceLabels = (orgId: string) => cache.publish(`org:${orgId}:updates`, { type: 'labels_changed' });
const refreshBoards = (orgId: string, projectIds: string[]) => Promise.all(projectIds.map((id) => cache.del(boardCacheKey(orgId, id))));

export const listLabels = (scope: TenantScope) => labels.listWithCounts(scope);

export async function createLabel(scope: TenantScope, name: string, color: string): Promise<Label & { task_count: number }> {
  const trimmed = name.trim();
  const label = await mapDuplicateName(() =>
    withTransaction(async (client) => {
      await labels.lockOrgForLabelCreate(client, scope);
      if ((await labels.count(client, scope)) >= MAX_LABELS_PER_ORG) {
        throw new ConflictError(`An organization can have at most ${MAX_LABELS_PER_ORG} labels`);
      }
      const created = await labels.insert(client, scope, trimmed, color);
      await logActivity(client, scope, 'label', created.id, 'created', { name: trimmed, color });
      return created;
    })
  );
  await announceLabels(scope.orgId);
  return { ...label, task_count: 0 };
}

export async function updateLabel(scope: TenantScope, id: string, changes: { name?: string; color?: string }): Promise<Label> {
  const name = changes.name?.trim();
  const { label, boards } = await mapDuplicateName(() =>
    withTransaction(async (client) => {
      const updated = await labels.update(client, scope, id, { name, color: changes.color });
      if (!updated) throw labelNotFound();
      await logActivity(client, scope, 'label', id, 'updated', { ...(name && { name }), ...(changes.color && { color: changes.color }) });
      return { label: updated, boards: await labels.projectsUsing(client, scope, id) };
    })
  );
  await refreshBoards(scope.orgId, boards);
  await announceLabels(scope.orgId);
  return label;
}

export async function deleteLabel(scope: TenantScope, id: string): Promise<void> {
  const boards = await withTransaction(async (client) => {
    const affected = await labels.projectsUsing(client, scope, id);
    const deleted = await labels.remove(client, scope, id);
    if (!deleted) throw labelNotFound();
    await logActivity(client, scope, 'label', id, 'deleted', { name: deleted.name });
    return affected;
  });
  await refreshBoards(scope.orgId, boards);
  await announceLabels(scope.orgId);
}

/** Replace a task's labels with `wanted` (each must be a label of the organization); returns the new set. */
export async function setTaskLabels(scope: TenantScope, projectId: string, taskId: string, wanted: string[]): Promise<TaskLabel[]> {
  const result = await withTransaction(async (client) => {
    if (!(await labels.lockTask(client, scope, projectId, taskId))) throw new NotFoundError('Task not found');
    if ((await labels.countKnown(client, scope, wanted)) !== wanted.length) {
      throw new BadRequestError('Every label must belong to your organization');
    }

    const have = new Set(await labels.labelIdsOfTask(client, scope, taskId));
    const added = wanted.filter((id) => !have.has(id));
    const removed = [...have].filter((id) => !wanted.includes(id));

    if (removed.length) await labels.detach(client, scope, taskId, removed);
    if (added.length) await labels.attach(client, scope, taskId, added);
    if (added.length || removed.length) {
      await labels.touchTask(client, scope, taskId);
      await logActivity(client, scope, 'task', taskId, 'labels_changed', { added, removed });
    }
    return labels.labelsOfTask(client, scope, taskId);
  });

  await cache.del(boardCacheKey(scope.orgId, projectId));
  await cache.publish(`org:${scope.orgId}:updates`, {
    type: 'task_updated',
    project_id: projectId,
    task_id: taskId,
    changes: { labels: result },
  });
  return result;
}
