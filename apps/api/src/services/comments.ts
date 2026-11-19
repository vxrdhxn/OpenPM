import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { hasMinRole } from '../plugins/auth';
import { announce, excerpt, notify } from '../notifications/notify';
import type { Page } from '../query/pagination';
import { BadRequestError, ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as comments from '../data/comments';
import type { Comment } from '../data/comments';
import * as tasks from '../data/tasks';
import type { TaskPath, TaskRef } from '../data/tasks';
import type { TenantScope } from '../data/scope';

/**
 * Comments on a task.
 *
 * - Read: anyone who can see the project (viewer+). Newest first, paginated.
 * - Write: members and above. Only the author edits their comment; the author or an admin deletes it.
 * - Every change is published to the organization channel (comment_created / comment_updated /
 *   comment_deleted) and recorded in activity_log (without the text itself).
 */

export const MAX_COMMENT_LENGTH = 10_000;
/** Most people one comment can mention. */
export const MAX_MENTIONS = 20;

const taskNotFound = () => new NotFoundError('Task not found');
const commentNotFound = () => new NotFoundError('Comment not found');

const publish = (orgId: string, type: string, payload: Record<string, unknown>) =>
  cache.publish(`org:${orgId}:updates`, { type, ...payload });

async function requireTask(client: PoolClient, scope: TenantScope, path: TaskPath): Promise<TaskRef> {
  const task = await tasks.findInProject(scope, path.projectId, path.taskId, client);
  if (!task) throw taskNotFound();
  return task;
}

/** Every mentioned id must be an active member of the organization who can see the project. */
async function assertMentionable(client: PoolClient, scope: TenantScope, projectId: string, ids: string[]) {
  if (ids.length === 0) return;
  if ((await comments.countMentionable(client, scope, projectId, ids)) !== ids.length) {
    throw new BadRequestError('You can only mention people who can see this project');
  }
}

export async function listComments(scope: TenantScope, path: TaskPath, limit: number, cursor?: string): Promise<Page<Comment>> {
  if (!(await tasks.findInProject(scope, path.projectId, path.taskId))) throw taskNotFound();
  return comments.listForTask(scope, path.taskId, limit, cursor);
}

export async function addComment(scope: TenantScope, path: TaskPath, body: string, mentionIds: string[] = []): Promise<Comment> {
  let notified: string[] = [];

  const comment = await withTransaction(async (client) => {
    const task = await requireTask(client, scope, path);
    await assertMentionable(client, scope, path.projectId, mentionIds);
    const id = await comments.insert(client, scope, path.taskId, body);
    await comments.replaceMentions(client, id, mentionIds);
    await logActivity(client, scope, 'comment', id, 'created', { task_id: path.taskId });

    const common = { orgId: scope.orgId, actorId: scope.userId, projectId: path.projectId, taskId: path.taskId, commentId: id };
    const data = { title: task.title, excerpt: excerpt(body) };
    notified = await notify(client, { ...common, type: 'mentioned', recipients: mentionIds, data });
    // The task's assignee and creator hear about the comment, unless they were just mentioned.
    notified.push(
      ...(await notify(client, {
        ...common,
        type: 'commented',
        recipients: [task.assignee_id, task.created_by].filter((r) => r && !mentionIds.includes(r)),
        data,
      }))
    );
    return (await comments.find(client, scope, path.taskId, id))!;
  });

  await announce(scope.orgId, notified);
  await publish(scope.orgId, 'comment_created', { project_id: path.projectId, task_id: path.taskId, comment });
  return comment;
}

/** Edit a comment (author only). `mentionIds`, when given, replaces the mentions; only people newly mentioned are notified. */
export async function editComment(
  scope: TenantScope,
  path: TaskPath,
  commentId: string,
  body: string,
  mentionIds?: string[]
): Promise<Comment> {
  let notified: string[] = [];

  const comment = await withTransaction(async (client) => {
    const task = await requireTask(client, scope, path);
    const existing = await comments.find(client, scope, path.taskId, commentId);
    if (!existing) throw commentNotFound();
    if (existing.author_id !== scope.userId) throw new ForbiddenError('Only the author can edit a comment');

    await comments.updateBody(client, scope, commentId, body);
    await logActivity(client, scope, 'comment', commentId, 'updated', { task_id: path.taskId });

    if (mentionIds) {
      await assertMentionable(client, scope, path.projectId, mentionIds);
      const added = await comments.replaceMentions(client, commentId, mentionIds);
      notified = await notify(client, {
        orgId: scope.orgId,
        actorId: scope.userId,
        type: 'mentioned',
        recipients: added,
        projectId: path.projectId,
        taskId: path.taskId,
        commentId,
        data: { title: task.title, excerpt: excerpt(body) },
      });
    }
    return (await comments.find(client, scope, path.taskId, commentId))!;
  });

  await announce(scope.orgId, notified);
  await publish(scope.orgId, 'comment_updated', { project_id: path.projectId, task_id: path.taskId, comment });
  return comment;
}

/** Delete a comment: its author, or an admin (recorded as moderated). */
export async function deleteComment(scope: TenantScope, path: TaskPath, commentId: string): Promise<void> {
  await withTransaction(async (client) => {
    await requireTask(client, scope, path);
    const existing = await comments.find(client, scope, path.taskId, commentId);
    if (!existing) throw commentNotFound();

    const isAuthor = existing.author_id === scope.userId;
    if (!isAuthor && !hasMinRole(scope.role, 'admin')) {
      throw new ForbiddenError('Only the author or an admin can delete a comment');
    }

    await comments.remove(client, scope, commentId);
    await logActivity(client, scope, 'comment', commentId, 'deleted', {
      task_id: path.taskId,
      author_id: existing.author_id,
      moderated: !isAuthor,
    });
  });

  await publish(scope.orgId, 'comment_deleted', { project_id: path.projectId, task_id: path.taskId, comment_id: commentId });
}
