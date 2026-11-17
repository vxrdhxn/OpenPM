import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { userCanSeeProject } from '../security/projectAccess';
import { deleteStoredObjects } from '../attachments/cleanup';
import { cache } from '../cache/redis';
import { enqueue } from '../jobs/enqueue';
import { Conditions, encodeCursor } from '../query/pagination';
import { applyTaskFilters, hasTaskFilters, TASK_STATUSES, taskFilterQuerySchema, type TaskFilters } from '../query/taskFilters';
import { labelsForTasks } from '../query/taskLabels';
import { announce, notify } from '../notifications/notify';

/**
 * Tasks per column in one board response (GET /:projectId/tasks); "Show more" pages through the rest
 * with GET /api/tasks. Measured in the Phase 9 load test: returning whole boards (up to 1000 tasks,
 * 250-500 KB) saturated the API at 20 boards/s; per-column pages keep a board bounded at 400 tasks
 * whatever the project's size (docs/load-testing.md).
 */
export const BOARD_COLUMN_LIMIT = 100;

/** Longest task description accepted (no limit before; 400 cards of unbounded text could be megabytes). */
export const MAX_DESCRIPTION_LENGTH = 50_000;

// Columns a client may change via PATCH. Everything else (org_id, project_id,
// created_by, id, ...) is server-controlled and must never be written from a request body.
const UPDATABLE_TASK_COLUMNS = new Set([
  'title',
  'description',
  'status',
  'priority',
  'assignee_id',
  'due_date',
]);

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  async function logActivity(client: any, orgId: string, userId: string, entityId: string, action: string, metadata: any = {}) {
    await client.query(
      'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [orgId, userId, 'task', entityId, action, JSON.stringify(metadata)]
    );
  }

  // The foreign key only proves the user exists somewhere. Without this check a task could be assigned
  // to another organization's user, whose name then shows on this org's board (and who gets the email),
  // or to someone who cannot see this (private) project and so could never open the task.
  async function assertAssigneeInOrg(client: any, assigneeId: string | null | undefined, orgId: string, projectId: string) {
    if (!assigneeId) return;
    if (!(await userCanSeeProject(client, orgId, projectId, assigneeId))) {
      throw new Error('INVALID_ASSIGNEE');
    }
  }

  const invalidAssignee = { error: 'Assignee must be a member of your organization who can see this project' };

  // POST /projects/:projectId/tasks (Requires member role or higher)
  fastify.post('/:projectId/tasks', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee_id: { type: 'string', format: 'uuid' },
          due_date: { type: 'string', format: 'date-time' }
        }
      }
    }
  }, async (request, reply) => {
    const { projectId } = request.params as any;
    const { title, description, priority = 'medium', assignee_id, due_date } = request.body as any;
    const { org_id, user_id } = request.user;

    let notified: string[] = [];
    try {
      const newTask = await withTransaction(async (client) => {
        // Verify project ownership within tenant boundary
        const projCheck = await client.query('SELECT id FROM projects WHERE id = $1 AND org_id = $2', [projectId, org_id]);
        if (projCheck.rows.length === 0) {
          throw new Error('PROJECT_NOT_FOUND');
        }
        await assertAssigneeInOrg(client, assignee_id, org_id, projectId);

        const res = await client.query(
          `INSERT INTO tasks (org_id, project_id, title, description, priority, assignee_id, due_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [org_id, projectId, title, description, priority, assignee_id, due_date, user_id]
        );
        const created = res.rows[0];

        await logActivity(client, org_id, user_id, created.id, 'created', { title });
        notified = await notify(client, {
          orgId: org_id,
          actorId: user_id,
          type: 'task_assigned',
          recipients: [assignee_id],
          projectId,
          taskId: created.id,
          data: { title },
        });
        return created;
      });
      await announce(org_id, notified);

      // Async background job processing
      // Best effort: the task is saved either way (jobs/enqueue.ts).
      await enqueue('task_created', {
        task_id: newTask.id,
        assignee_id: assignee_id,
        org_id: org_id,
        // Lets the worker log under the same id as the request that caused this job.
        request_id: request.id
      }, undefined, request.log);

      // Clear cache and emit WS event
      await cache.del(`org:${org_id}:project:${projectId}:tasks`);
      await cache.publish(`org:${org_id}:updates`, {
        type: 'task_created',
        project_id: projectId,
        task: newTask
      });

      return reply.code(201).send(newTask);
    } catch (err: any) {
      if (err.message === 'PROJECT_NOT_FOUND') return reply.code(404).send({ error: 'Project not found' });
      if (err.message === 'INVALID_ASSIGNEE') return reply.code(400).send(invalidAssignee);
      throw err;
    }
  });

  // GET /projects/:projectId/tasks (Viewer or higher): the board.
  // { todo: [...], in_progress: [...], in_review: [...], done: [...], totals: {...}, cursors: {...} }
  // Each column holds its first BOARD_COLUMN_LIMIT tasks (oldest first); `totals` counts every match;
  // `cursors[column]`, when not null, continues that column via
  // GET /api/tasks?project_id=&status=<column>&sort=created_at&order=asc&cursor=<it> (same filters).
  fastify.get('/:projectId/tasks', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: taskFilterQuerySchema,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { projectId } = request.params as any;
    const { org_id, user_id } = request.user;
    const filters = request.query as TaskFilters;

    // Only the unfiltered board is cached; every task write clears it.
    const cacheable = !hasTaskFilters(filters);
    const cacheKey = `org:${org_id}:project:${projectId}:tasks`;
    if (cacheable) {
      const cached = await cache.get(cacheKey);
      if (cached) {
        return reply.send(cached);
      }
    }

    // Verify project ownership within tenant boundary
    const projCheck = await db.query('SELECT id FROM projects WHERE id = $1 AND org_id = $2', [projectId, org_id]);
    if (projCheck.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const where = new Conditions()
      .add((p) => `t.project_id = ${p(projectId)}`)
      .add((p) => `t.org_id = ${p(org_id)}`);
    applyTaskFilters(where, filters, user_id);
    const columns: string[] = filters.status?.length ? filters.status : [...TASK_STATUSES];

    // One bounded index range scan per column (idx_tasks_project_status_created), plus the totals.
    const columnParam = where.param(columns);
    const limitParam = where.param(BOARD_COLUMN_LIMIT + 1);
    const [rows, counts] = await Promise.all([
      db.query(
        `SELECT t.*, u.name AS assignee_name, t.created_at::text AS sort_key
           FROM unnest(${columnParam}::text[]) AS col(status)
           CROSS JOIN LATERAL (
             SELECT t.* FROM tasks t
              WHERE ${where.sql()} AND t.status = col.status
              ORDER BY t.created_at ASC, t.id ASC
              LIMIT ${limitParam}
           ) t
           LEFT JOIN users u ON u.id = t.assignee_id`,
        where.params
      ),
      db.query<{ status: string; n: number }>(
        `SELECT t.status, count(*)::int AS n FROM tasks t WHERE ${where.sql()} GROUP BY t.status`,
        where.params.slice(0, where.params.length - 2)
      ),
    ]);

    const labels = await labelsForTasks(rows.map((r) => r.id), org_id);
    const board: Record<string, unknown> = {};
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
    const response = { ...board, totals, cursors };

    if (cacheable) await cache.set(cacheKey, response, 60); // 60 seconds TTL

    return reply.send(response);
  });

  // PATCH /projects/:projectId/tasks/:taskId (Requires member role or higher)
  fastify.patch('/:projectId/tasks/:taskId', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
          status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee_id: { type: 'string', format: 'uuid', nullable: true },
          due_date: { type: 'string', format: 'date-time', nullable: true }
        },
        // Reject unknown keys (the app runs Ajv with removeAdditional: false) and empty bodies.
        minProperties: 1,
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const updates = request.body as any;
    const { org_id, user_id } = request.user;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    let notified: string[] = [];
    try {
      const updatedTask = await withTransaction(async (client) => {
        const check = await client.query(
          'SELECT status, assignee_id, created_by FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3',
          [taskId, projectId, org_id]
        );
        if (check.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        const oldStatus = check.rows[0].status;
        await assertAssigneeInOrg(client, updates.assignee_id, org_id, projectId);

        const setClauses = [];
        const values = [];
        let i = 1;
        for (const [key, value] of Object.entries(updates)) {
          // Defense in depth: only whitelisted names may ever become SQL identifiers,
          // even if the schema above is loosened later.
          if (!UPDATABLE_TASK_COLUMNS.has(key)) {
            throw new Error('UNSUPPORTED_FIELD');
          }
          setClauses.push(`${key} = $${i}`);
          values.push(value);
          i++;
        }
        setClauses.push(`updated_at = NOW()`);
        values.push(taskId, projectId, org_id);

        const res = await client.query(
          `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${i} AND project_id = $${i+1} AND org_id = $${i+2} RETURNING *`,
          values
        );

        const metadata: any = { changes: Object.keys(updates) };
        if (updates.status && updates.status !== oldStatus) {
          metadata.from = oldStatus;
          metadata.to = updates.status;
        }

        await logActivity(client, org_id, user_id, taskId, 'updated', metadata);

        // Notifications (never to the person making the change; see notifications/notify.ts).
        const task = res.rows[0];
        const before = check.rows[0];
        const newlyAssigned = updates.assignee_id && updates.assignee_id !== before.assignee_id ? updates.assignee_id : null;
        notified = await notify(client, {
          orgId: org_id,
          actorId: user_id,
          type: 'task_assigned',
          recipients: [newlyAssigned],
          projectId,
          taskId,
          data: { title: task.title },
        });
        if (metadata.to) {
          notified.push(
            ...(await notify(client, {
              orgId: org_id,
              actorId: user_id,
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
      await announce(org_id, notified);

      // Pub/Sub notification for real-time collaboration
      await cache.publish(`org:${org_id}:updates`, {
        type: 'task_updated',
        project_id: projectId,
        task_id: taskId,
        changes: updates,
        task: updatedTask
      });

      await cache.del(`org:${org_id}:project:${projectId}:tasks`);

      return reply.send(updatedTask);
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ error: 'Task not found' });
      if (err.message === 'UNSUPPORTED_FIELD') return reply.code(400).send({ error: 'Unsupported task field' });
      if (err.message === 'INVALID_ASSIGNEE') return reply.code(400).send(invalidAssignee);
      throw err;
    }
  });

  // DELETE /projects/:projectId/tasks/:taskId (Requires admin role or higher)
  fastify.delete('/:projectId/tasks/:taskId', {
    preHandler: fastify.requireRole('admin')
  }, async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const { org_id, user_id } = request.user;

    try {
      const orphanedKeys = await withTransaction(async (client) => {
        // The task's attachment rows would be removed by ON DELETE CASCADE anyway, but the files
        // in object storage would not. Delete the rows explicitly to learn exactly which keys to
        // clean up. If the task turns out not to exist, the rollback restores these rows.
        const attachments = await client.query(
          'DELETE FROM task_attachments WHERE task_id = $1 AND org_id = $2 RETURNING storage_key',
          [taskId, org_id]
        );

        const res = await client.query(
          'DELETE FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 RETURNING id, title',
          [taskId, projectId, org_id]
        );

        if (res.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        // The title is kept so the activity feed can still say what was deleted, and the project so
        // the feed can still tell who may see that (private projects).
        await logActivity(client, org_id, user_id, taskId, 'deleted', { title: res.rows[0].title, project_id: projectId });
        return attachments.rows.map((r: { storage_key: string }) => r.storage_key);
      });

      // Only after commit, so a rolled-back delete never loses files that are still referenced.
      await deleteStoredObjects(orphanedKeys, request.log);

      await cache.del(`org:${org_id}:project:${projectId}:tasks`);
      await cache.publish(`org:${org_id}:updates`, {
        type: 'task_deleted',
        project_id: projectId,
        task_id: taskId
      });
      return reply.code(204).send();
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ error: 'Task not found' });
      throw err;
    }
  });
};

export default taskRoutes;

