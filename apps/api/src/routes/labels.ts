import { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { seesAllProjects, visibleProjectSql } from '../security/projectAccess';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
/** Most labels one organization can have, so the label list and pickers stay bounded. */
export const MAX_LABELS_PER_ORG = 200;
/** Most labels on one task. */
export const MAX_LABELS_PER_TASK = 20;

const LABEL_COLUMNS = 'id, name, color, created_at';

const nameSchema = { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' } as const;
const colorSchema = { type: 'string', enum: [...LABEL_COLORS] } as const;

class LabelError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const DUPLICATE_NAME = () => new LabelError(409, 'A label with this name already exists');
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

async function logLabelActivity(
  client: PoolClient,
  orgId: string,
  userId: string,
  entityType: 'label' | 'task',
  entityId: string,
  action: string,
  metadata: Record<string, unknown>
) {
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, userId, entityType, entityId, action, JSON.stringify(metadata)]
  );
}

/** Projects whose boards show this label (their cached boards must be dropped when it changes). */
async function projectsUsingLabel(client: PoolClient, orgId: string, labelId: string): Promise<string[]> {
  const res = await client.query<{ project_id: string }>(
    `SELECT DISTINCT t.project_id
       FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
      WHERE tl.label_id = $1 AND tl.org_id = $2`,
    [labelId, orgId]
  );
  return res.rows.map((r) => r.project_id);
}

async function refreshBoards(orgId: string, projectIds: string[]) {
  await Promise.all(projectIds.map((id) => cache.del(`org:${orgId}:project:${id}:tasks`)));
}

/**
 * The organization's labels: /api/labels. Anyone can see them, members create and edit them, admins
 * delete them (which removes them from every task). Changes publish `labels_changed` so open boards
 * refresh.
 */
export const labelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  const handle = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof LabelError) return reply.code(err.status).send({ error: err.message });
    if (isUniqueViolation(err)) return reply.code(409).send({ error: DUPLICATE_NAME().message });
    throw err;
  };

  const announce = (orgId: string) => cache.publish(`org:${orgId}:updates`, { type: 'labels_changed' });

  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => {
    // Counts only tasks in projects the caller can see (private projects). $2 is the caller's id; it
    // is referenced either way, because Postgres rejects a bound parameter the query never uses.
    const visible = seesAllProjects(request.user.role) ? '$2::uuid IS NOT NULL' : visibleProjectSql('p', request.user, () => '$2');
    return db.query(
      `SELECT l.id, l.name, l.color, l.created_at,
              (SELECT count(*)::int FROM task_labels tl
                 JOIN tasks t ON t.id = tl.task_id
                 JOIN projects p ON p.id = t.project_id
                WHERE tl.label_id = l.id AND ${visible}) AS task_count
         FROM labels l
        WHERE l.org_id = $1
        ORDER BY lower(l.name), l.id`,
      [request.user.org_id, request.user.user_id]
    );
  });

  fastify.post('/', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: nameSchema, color: { ...colorSchema, default: 'gray' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { name, color } = request.body as { name: string; color: string };

    try {
      const label = await withTransaction(async (client) => {
        // Serialize creates in this org so the limit holds under concurrency.
        await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [org_id]);
        const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM labels WHERE org_id = $1', [org_id]);
        if (count.rows[0]!.n >= MAX_LABELS_PER_ORG) {
          throw new LabelError(409, `An organization can have at most ${MAX_LABELS_PER_ORG} labels`);
        }
        const res = await client.query(
          `INSERT INTO labels (org_id, name, color) VALUES ($1, $2, $3) RETURNING ${LABEL_COLUMNS}`,
          [org_id, name.trim(), color]
        );
        await logLabelActivity(client, org_id, user_id, 'label', res.rows[0].id, 'created', { name: name.trim(), color });
        return res.rows[0];
      });
      await announce(org_id);
      return reply.code(201).send({ ...label, task_count: 0 });
    } catch (err) {
      return handle(reply, err);
    }
  });

  fastify.patch('/:id', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        properties: { name: nameSchema, color: colorSchema },
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as { id: string };
    const { name, color } = request.body as { name?: string; color?: string };

    try {
      const { label, boards } = await withTransaction(async (client) => {
        const res = await client.query(
          `UPDATE labels SET name = COALESCE($1, name), color = COALESCE($2, color)
            WHERE id = $3 AND org_id = $4 RETURNING ${LABEL_COLUMNS}`,
          [name?.trim() ?? null, color ?? null, id, org_id]
        );
        if (res.rows.length === 0) throw new LabelError(404, 'Label not found');
        await logLabelActivity(client, org_id, user_id, 'label', id, 'updated', { ...(name && { name: name.trim() }), ...(color && { color }) });
        return { label: res.rows[0], boards: await projectsUsingLabel(client, org_id, id) };
      });
      await refreshBoards(org_id, boards);
      await announce(org_id);
      return reply.send(label);
    } catch (err) {
      return handle(reply, err);
    }
  });

  fastify.delete('/:id', { preHandler: fastify.requireRole('admin') }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as { id: string };

    try {
      const boards = await withTransaction(async (client) => {
        const affected = await projectsUsingLabel(client, org_id, id);
        const res = await client.query<{ name: string }>('DELETE FROM labels WHERE id = $1 AND org_id = $2 RETURNING name', [id, org_id]);
        if (res.rows.length === 0) throw new LabelError(404, 'Label not found');
        await logLabelActivity(client, org_id, user_id, 'label', id, 'deleted', { name: res.rows[0]!.name });
        return affected;
      });
      await refreshBoards(org_id, boards);
      await announce(org_id);
      return reply.code(204).send();
    } catch (err) {
      return handle(reply, err);
    }
  });
};

/**
 * A task's labels: PUT /api/projects/:projectId/tasks/:taskId/labels { label_ids } replaces the set.
 * Members and above. Every id must be a label of the caller's organization.
 */
export const taskLabelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.put('/:projectId/tasks/:taskId/labels', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['label_ids'],
        properties: {
          label_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: MAX_LABELS_PER_TASK, uniqueItems: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    const { label_ids: wanted } = request.body as { label_ids: string[] };

    try {
      const labels = await withTransaction(async (client) => {
        // Lock the task so two concurrent edits of its labels apply one after the other.
        const task = await client.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 FOR UPDATE', [taskId, projectId, org_id]);
        if (task.rows.length === 0) throw new LabelError(404, 'Task not found');

        const known = await client.query<{ id: string }>('SELECT id FROM labels WHERE org_id = $1 AND id = ANY($2::uuid[])', [org_id, wanted]);
        if (known.rows.length !== wanted.length) throw new LabelError(400, 'Every label must belong to your organization');

        const current = await client.query<{ label_id: string }>('SELECT label_id FROM task_labels WHERE task_id = $1', [taskId]);
        const have = new Set(current.rows.map((r) => r.label_id));
        const added = wanted.filter((id) => !have.has(id));
        const removed = [...have].filter((id) => !wanted.includes(id));

        if (removed.length) {
          await client.query('DELETE FROM task_labels WHERE task_id = $1 AND label_id = ANY($2::uuid[])', [taskId, removed]);
        }
        if (added.length) {
          await client.query(
            'INSERT INTO task_labels (task_id, label_id, org_id) SELECT $1, unnest($2::uuid[]), $3',
            [taskId, added, org_id]
          );
        }
        if (added.length || removed.length) {
          await client.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [taskId]);
          await logLabelActivity(client, org_id, user_id, 'task', taskId, 'labels_changed', { added, removed });
        }

        const res = await client.query(
          `SELECT l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id = $1 ORDER BY lower(l.name), l.id`,
          [taskId]
        );
        return res.rows;
      });

      await cache.del(`org:${org_id}:project:${projectId}:tasks`);
      await cache.publish(`org:${org_id}:updates`, {
        type: 'task_updated',
        project_id: projectId,
        task_id: taskId,
        changes: { labels },
      });
      return reply.send(labels);
    } catch (err) {
      if (err instanceof LabelError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
};
