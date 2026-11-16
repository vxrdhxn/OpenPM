import { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { hasMinRole } from '../plugins/auth';
import { Conditions, decodeCursor, paginationQuerySchema, toPage } from '../query/pagination';

export const MAX_COMMENT_LENGTH = 10_000;

/** Every comment response has this shape (author name joined in, removed authors flagged). */
const commentSelect = (extraColumns = '') => `
  SELECT c.id, c.task_id, c.body, c.author_id, u.name AS author_name,
         (u.deactivated_at IS NOT NULL) AS author_removed,
         c.created_at, c.updated_at, c.edited_at${extraColumns}
    FROM task_comments c
    JOIN users u ON u.id = c.author_id`;

const TASK_IN_ORG = 'SELECT id FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3';

const bodySchema = {
  type: 'object',
  required: ['body'],
  properties: {
    // At least one non-whitespace character.
    body: { type: 'string', minLength: 1, maxLength: MAX_COMMENT_LENGTH, pattern: '\\S' },
  },
  additionalProperties: false,
} as const;

interface TaskParams {
  projectId: string;
  taskId: string;
}
interface CommentParams extends TaskParams {
  commentId: string;
}

class CommentError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const TASK_NOT_FOUND = () => new CommentError(404, 'Task not found');
const COMMENT_NOT_FOUND = () => new CommentError(404, 'Comment not found');

/** The task must belong to the project, and both to the caller's organization. */
async function assertTask(client: PoolClient, { projectId, taskId }: TaskParams, orgId: string) {
  const res = await client.query(TASK_IN_ORG, [taskId, projectId, orgId]);
  if (res.rows.length === 0) throw TASK_NOT_FOUND();
}

async function loadComment(client: PoolClient, commentId: string, taskId: string, orgId: string) {
  const res = await client.query(`${commentSelect()} WHERE c.id = $1 AND c.task_id = $2 AND c.org_id = $3`, [commentId, taskId, orgId]);
  return res.rows[0];
}

async function logCommentActivity(
  client: PoolClient,
  orgId: string,
  userId: string,
  commentId: string,
  action: 'created' | 'updated' | 'deleted',
  metadata: Record<string, unknown>
) {
  // The text itself is not copied into the audit log.
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, userId, 'comment', commentId, action, JSON.stringify(metadata)]
  );
}

/**
 * Comments on a task: /api/projects/:projectId/tasks/:taskId/comments.
 *
 * - Read: anyone in the organization (viewer+). Newest first, paginated; the UI shows them oldest-first
 *   and loads earlier ones on demand.
 * - Write: members and above. Only the author edits their comment; the author or an admin deletes it.
 * - Every change is published to the organization channel (comment_created / comment_updated /
 *   comment_deleted) and recorded in activity_log.
 */
const commentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  const base = '/:projectId/tasks/:taskId/comments';

  const handle = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof CommentError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };

  const publish = (orgId: string, type: string, payload: Record<string, unknown>) =>
    cache.publish(`org:${orgId}:updates`, { type, ...payload });

  fastify.get(base, {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: { type: 'object', properties: { ...paginationQuerySchema }, additionalProperties: false },
    },
  }, async (request, reply) => {
    const { org_id } = request.user;
    const params = request.params as TaskParams;
    const { limit, cursor } = request.query as { limit: number; cursor?: string };

    const task = await db.query(TASK_IN_ORG, [params.taskId, params.projectId, org_id]);
    if (task.length === 0) return reply.code(404).send({ error: 'Task not found' });

    const where = new Conditions()
      .add((p) => `c.task_id = ${p(params.taskId)}`)
      .add((p) => `c.org_id = ${p(org_id)}`);
    if (cursor) {
      const after = decodeCursor(cursor);
      where.add((p) => `(c.created_at, c.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
    }

    const rows = await db.query(
      `${commentSelect(', c.created_at::text AS sort_key')}
        WHERE ${where.sql()}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${where.param(limit + 1)}`,
      where.params
    );
    return reply.send(toPage(rows, limit));
  });

  fastify.post(base, {
    preHandler: fastify.requireRole('member'),
    schema: { body: bodySchema },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const params = request.params as TaskParams;
    const { body } = request.body as { body: string };

    try {
      const comment = await withTransaction(async (client) => {
        await assertTask(client, params, org_id);
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO task_comments (org_id, task_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
          [org_id, params.taskId, user_id, body]
        );
        const id = inserted.rows[0]!.id;
        await logCommentActivity(client, org_id, user_id, id, 'created', { task_id: params.taskId });
        return loadComment(client, id, params.taskId, org_id);
      });

      await publish(org_id, 'comment_created', { project_id: params.projectId, task_id: params.taskId, comment });
      return reply.code(201).send(comment);
    } catch (err) {
      return handle(reply, err);
    }
  });

  fastify.patch(`${base}/:commentId`, {
    preHandler: fastify.requireRole('member'),
    schema: { body: bodySchema },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const params = request.params as CommentParams;
    const { body } = request.body as { body: string };

    try {
      const comment = await withTransaction(async (client) => {
        await assertTask(client, params, org_id);
        const existing = await loadComment(client, params.commentId, params.taskId, org_id);
        if (!existing) throw COMMENT_NOT_FOUND();
        if (existing.author_id !== user_id) throw new CommentError(403, 'Only the author can edit a comment');

        await client.query(
          'UPDATE task_comments SET body = $1, edited_at = NOW(), updated_at = NOW() WHERE id = $2 AND org_id = $3',
          [body, params.commentId, org_id]
        );
        await logCommentActivity(client, org_id, user_id, params.commentId, 'updated', { task_id: params.taskId });
        return loadComment(client, params.commentId, params.taskId, org_id);
      });

      await publish(org_id, 'comment_updated', { project_id: params.projectId, task_id: params.taskId, comment });
      return reply.send(comment);
    } catch (err) {
      return handle(reply, err);
    }
  });

  fastify.delete(`${base}/:commentId`, {
    preHandler: fastify.requireRole('member'),
  }, async (request, reply) => {
    const { org_id, user_id, role } = request.user;
    const params = request.params as CommentParams;

    try {
      await withTransaction(async (client) => {
        await assertTask(client, params, org_id);
        const existing = await loadComment(client, params.commentId, params.taskId, org_id);
        if (!existing) throw COMMENT_NOT_FOUND();

        const isAuthor = existing.author_id === user_id;
        if (!isAuthor && !hasMinRole(role, 'admin')) {
          throw new CommentError(403, 'Only the author or an admin can delete a comment');
        }

        await client.query('DELETE FROM task_comments WHERE id = $1 AND org_id = $2', [params.commentId, org_id]);
        await logCommentActivity(client, org_id, user_id, params.commentId, 'deleted', {
          task_id: params.taskId,
          author_id: existing.author_id,
          moderated: !isAuthor,
        });
      });

      await publish(org_id, 'comment_deleted', {
        project_id: params.projectId,
        task_id: params.taskId,
        comment_id: params.commentId,
      });
      return reply.code(204).send();
    } catch (err) {
      return handle(reply, err);
    }
  });
};

export default commentRoutes;
