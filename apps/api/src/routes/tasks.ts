import { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { db } from '../db/client';
import { cache } from '../cache/redis';
import { config } from '../config';

const taskQueue = new Queue('tasks', {
  connection: {
    url: config.REDIS_URL,
  }
});

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  async function logActivity(client: any, orgId: string, userId: string, entityId: string, action: string, metadata: any = {}) {
    await client.query(
      'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [orgId, userId, 'task', entityId, action, JSON.stringify(metadata)]
    );
  }

  // POST /projects/:projectId/tasks
  fastify.post('/:projectId/tasks', {
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
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

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      // Verify project ownership
      const projCheck = await client.query('SELECT id FROM projects WHERE id = $1 AND org_id = $2', [projectId, org_id]);
      if (projCheck.rows.length === 0) {
        throw new Error('PROJECT_NOT_FOUND');
      }

      const res = await client.query(
        `INSERT INTO tasks (org_id, project_id, title, description, priority, assignee_id, due_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [org_id, projectId, title, description, priority, assignee_id, due_date, user_id]
      );
      const newTask = res.rows[0];

      await logActivity(client, org_id, user_id, newTask.id, 'created', { title });
      await client.query('COMMIT');

      // Async background job processing
      await taskQueue.add('task_created', {
        task_id: newTask.id,
        assignee_id: assignee_id,
        org_id: org_id
      });

      // Clear cache and emit WS event
      await cache.del(`org:${org_id}:project:${projectId}:tasks`);
      await cache.publish(`org:${org_id}:updates`, {
        type: 'task_created',
        project_id: projectId,
        task: newTask
      });

      return reply.code(201).send(newTask);
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.message === 'PROJECT_NOT_FOUND') return reply.code(404).send({ error: 'Project not found' });
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /projects/:projectId/tasks
  fastify.get('/:projectId/tasks', async (request, reply) => {
    const { projectId } = request.params as any;
    const { org_id } = request.user;

    const cacheKey = `org:${org_id}:project:${projectId}:tasks`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return reply.send(cached);
    }

    // Verify project ownership
    const projCheck = await db.query('SELECT id FROM projects WHERE id = $1 AND org_id = $2', [projectId, org_id]);
    if (projCheck.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const tasks = await db.query(
      `SELECT t.*, u.name as assignee_name 
       FROM tasks t 
       LEFT JOIN users u ON t.assignee_id = u.id 
       WHERE t.project_id = $1 AND t.org_id = $2 
       ORDER BY t.created_at ASC`,
      [projectId, org_id]
    );

    // Group tasks by status for the kanban board
    const grouped = {
      todo: tasks.filter(t => t.status === 'todo'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      in_review: tasks.filter(t => t.status === 'in_review'),
      done: tasks.filter(t => t.status === 'done')
    };

    await cache.set(cacheKey, grouped, 60); // 60 seconds TTL

    return reply.send(grouped);
  });

  // PATCH /projects/:projectId/tasks/:taskId
  fastify.patch('/:projectId/tasks/:taskId', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          assignee_id: { type: 'string', format: 'uuid', nullable: true },
          due_date: { type: 'string', format: 'date-time', nullable: true }
        }
      }
    }
  }, async (request, reply) => {
    const { projectId, taskId } = request.params as any;
    const updates = request.body as any;
    const { org_id, user_id } = request.user;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const check = await client.query(
        'SELECT status FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3', 
        [taskId, projectId, org_id]
      );
      if (check.rows.length === 0) {
        throw new Error('NOT_FOUND');
      }

      const oldStatus = check.rows[0].status;

      const setClauses = [];
      const values = [];
      let i = 1;
      for (const [key, value] of Object.entries(updates)) {
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

      const updatedTask = res.rows[0];

      let metadata: any = { changes: Object.keys(updates) };
      if (updates.status && updates.status !== oldStatus) {
        metadata.from = oldStatus;
        metadata.to = updates.status;
      }

      await logActivity(client, org_id, user_id, taskId, 'updated', metadata);
      await client.query('COMMIT');

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
      await client.query('ROLLBACK');
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ error: 'Task not found' });
      throw err;
    } finally {
      client.release();
    }
  });
};

export default taskRoutes;
