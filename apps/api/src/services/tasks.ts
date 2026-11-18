import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { enqueue } from '../jobs/enqueue';
import { deleteStoredObjects } from '../attachments/cleanup';
import { announce, notify } from '../notifications/notify';
import { userCanSeeProject } from '../security/projectAccess';
import { encodeCursor } from '../query/pagination';
import { hasTaskFilters, TASK_STATUSES, type TaskFilters } from '../query/taskFilters';
import { labelsForTasks, type TaskLabel } from '../query/taskLabels';
import { BadRequestError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as projects from '../data/projects';
import * as tasks from '../data/tasks';
import type { NewTaskFields, TaskChanges, TaskPriority, TaskRow } from '../data/tasks';
import type { TenantScope } from '../data/scope';

/**
 * Tasks per column in one board response; "Show more" pages through the rest with GET /api/tasks.
 * Measured in the Phase 9 load test: returning whole boards (up to 1000 tasks, 250-500 KB) saturated
 * the API at 20 boards/s; per-column pages keep a board bounded at 400 tasks whatever the project's
 * size (docs/load-testing.md).
 */
export const BOARD_COLUMN_LIMIT = 100;

/** Longest task description accepted (400 cards of unbounded text could be megabytes). */
export const MAX_DESCRIPTION_LENGTH = 50_000;

const BOARD_CACHE_SECONDS = 60;
export const boardCacheKey = (orgId: string, projectId: string) => `org:${orgId}:project:${projectId}:tasks`;
const updatesChannel = (orgId: string) => `org:${orgId}:updates`;

const taskNotFound = () => new NotFoundError('Task not found');

/**
 * The foreign key only proves the user exists somewhere. Without this check a task could be assigned
 * to another organization's user, whose name then shows on this org's board (and who gets the email),
 * or to someone who cannot see this (private) project and so could never open the task.
 */
async function assertAssignable(client: PoolClient, scope: TenantScope, projectId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  if (!(await userCanSeeProject(client, scope.orgId, projectId, assigneeId))) {
    throw new BadRequestError('Assignee must be a member of your organization who can see this project');
  }
}

/** What a request may send to create a task (priority defaults to medium). */
export type NewTask = Omit<NewTaskFields, 'priority'> & { priority?: TaskPriority };

export async function createTask(scope: TenantScope, projectId: string, input: NewTask, requestId: string, log: Parameters<typeof enqueue>[3]) {
  const fields: NewTaskFields = { ...input, priority: input.priority ?? 'medium' };
  let notified: string[] = [];

  const created = await withTransaction(async (client) => {
    if (!(await projects.existsInOrg(scope, projectId, client))) throw new NotFoundError('Project not found');
    await assertAssignable(client, scope, projectId, fields.assignee_id);

    const task = await tasks.insert(client, scope, projectId, fields);
    await logActivity(client, scope, 'task', task.id, 'created', { title: fields.title });
    notified = await notify(client, {
      orgId: scope.orgId,
      actorId: scope.userId,
      type: 'task_assigned',
      recipients: [fields.assignee_id],
      projectId,
      taskId: task.id,
      data: { title: fields.title },
    });
    return task;
  });
  await announce(scope.orgId, notified);

  // Best effort: the task is saved either way (jobs/enqueue.ts). The request id lets the worker log
  // under the same id as the request that caused the job.
  await enqueue(
    'task_created',
    { task_id: created.id, assignee_id: fields.assignee_id, org_id: scope.orgId, request_id: requestId },
    undefined,
    log
  );

  await cache.del(boardCacheKey(scope.orgId, projectId));
  await cache.publish(updatesChannel(scope.orgId), { type: 'task_created', project_id: projectId, task: created });
  return created;
}

type BoardTask = Omit<tasks.BoardRow, 'sort_key'> & { labels: TaskLabel[] };
export type Board = Record<string, unknown> & {
  totals: Record<string, number>;
  cursors: Record<string, string | null>;
};

/**
 * The board: `{ todo: [...], in_progress: [...], in_review: [...], done: [...], totals, cursors }`.
 * Each column holds its first BOARD_COLUMN_LIMIT tasks (oldest first); `totals` counts every match;
 * `cursors[column]`, when not null, continues that column via
 * GET /api/tasks?project_id=&status=<column>&sort=created_at&order=asc&cursor=<it> (same filters).
 * Only the unfiltered board is cached; every task write clears it.
 */
export async function getBoard(scope: TenantScope, projectId: string, filters: TaskFilters): Promise<Board> {
  const cacheable = !hasTaskFilters(filters);
  const cacheKey = boardCacheKey(scope.orgId, projectId);
  if (cacheable) {
    const cached = await cache.get<Board>(cacheKey);
    if (cached) return cached;
  }

  if (!(await projects.existsInOrg(scope, projectId))) throw new NotFoundError('Project not found');

  const columns: readonly string[] = filters.status?.length ? filters.status : TASK_STATUSES;
  // One extra row per column tells whether that column has more.
  const { rows, counts } = await tasks.boardColumns(scope, projectId, filters, columns, BOARD_COLUMN_LIMIT + 1);
  const labels = await labelsForTasks(rows.map((r) => r.id), scope.orgId);

  const board: Record<string, BoardTask[]> = {};
  const totals: Record<string, number> = {};
  const cursors: Record<string, string | null> = {};
  for (const status of TASK_STATUSES) {
    const column = rows
      .filter((r) => r.status === status)
      .sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : a.id < b.id ? -1 : 1));
    const page = column.slice(0, BOARD_COLUMN_LIMIT);
    const last = page[page.length - 1];
    board[status] = page.map(({ sort_key: _sortKey, ...task }) => ({ ...task, labels: labels.get(task.id) ?? [] }));
    totals[status] = counts.find((c) => c.status === status)?.n ?? 0;
    cursors[status] = column.length > BOARD_COLUMN_LIMIT && last ? encodeCursor({ key: last.sort_key, id: last.id }) : null;
  }
  const response: Board = { ...board, totals, cursors };

  if (cacheable) await cache.set(cacheKey, response, BOARD_CACHE_SECONDS);
  return response;
}

/**
 * Change a task. Notifies a newly assigned person, and on a status change the assignee and the
 * creator (never the person making the change; see notifications/notify.ts).
 */
export async function updateTask(scope: TenantScope, projectId: string, taskId: string, changes: TaskChanges): Promise<TaskRow> {
  let notified: string[] = [];

  const updated = await withTransaction(async (client) => {
    const before = await tasks.lockForUpdate(client, scope, projectId, taskId);
    if (!before) throw taskNotFound();
    await assertAssignable(client, scope, projectId, changes.assignee_id);

    const task = await tasks.update(client, scope, projectId, taskId, changes);
    if (!task) throw taskNotFound();

    const statusChanged = changes.status !== undefined && changes.status !== before.status;
    const metadata: { changes: string[]; from?: string; to?: string } = { changes: Object.keys(changes) };
    if (statusChanged) {
      metadata.from = before.status;
      metadata.to = changes.status;
    }
    await logActivity(client, scope, 'task', taskId, 'updated', metadata);

    const newlyAssigned = changes.assignee_id && changes.assignee_id !== before.assignee_id ? changes.assignee_id : null;
    notified = await notify(client, {
      orgId: scope.orgId,
      actorId: scope.userId,
      type: 'task_assigned',
      recipients: [newlyAssigned],
      projectId,
      taskId,
      data: { title: task.title },
    });
    if (statusChanged) {
      notified.push(
        ...(await notify(client, {
          orgId: scope.orgId,
          actorId: scope.userId,
          type: 'status_changed',
          // The person just assigned already got a notification for this change.
          recipients: [task.assignee_id, before.created_by].filter((id) => id !== newlyAssigned),
          projectId,
          taskId,
          data: { title: task.title, from: metadata.from, to: metadata.to },
        }))
      );
    }
    return task;
  });
  await announce(scope.orgId, notified);

  await cache.publish(updatesChannel(scope.orgId), {
    type: 'task_updated',
    project_id: projectId,
    task_id: taskId,
    changes,
    task: updated,
  });
  await cache.del(boardCacheKey(scope.orgId, projectId));
  return updated;
}

/** Delete a task; its files in object storage are removed after the commit (see services/projects.deleteProject). */
export async function deleteTask(scope: TenantScope, projectId: string, taskId: string, log: Parameters<typeof deleteStoredObjects>[1]) {
  const orphanedKeys = await withTransaction(async (client) => {
    const keys = await tasks.deleteAttachments(client, scope, taskId);
    const deleted = await tasks.remove(client, scope, projectId, taskId);
    if (!deleted) throw taskNotFound(); // the rollback restores the attachment rows

    // The title is kept so the activity feed can still say what was deleted, and the project so the
    // feed can still tell who may see that (private projects).
    await logActivity(client, scope, 'task', taskId, 'deleted', { title: deleted.title, project_id: projectId });
    return keys;
  });

  await deleteStoredObjects(orphanedKeys, log);
  await cache.del(boardCacheKey(scope.orgId, projectId));
  await cache.publish(updatesChannel(scope.orgId), { type: 'task_deleted', project_id: projectId, task_id: taskId });
}
