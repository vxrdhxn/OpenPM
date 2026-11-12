import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { deleteStoredObjects } from '../attachments/cleanup';
import { cache } from '../cache/redis';

const projectRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes in this plugin require authentication
  fastify.addHook('preValidation', fastify.authenticate);

  // Helper to log activity
  async function logActivity(client: any, orgId: string, userId: string, entityId: string, action: string, metadata: any = {}) {
    await client.query(
      'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [orgId, userId, 'project', entityId, action, JSON.stringify(metadata)]
    );
  }

  // POST / (Requires member role or higher)
  fastify.post('/', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' }
        },
        minProperties: 1,
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { name, description } = request.body as any;
    const { org_id, user_id } = request.user;

    const newProject = await withTransaction(async (client) => {
      const res = await client.query(
        'INSERT INTO projects (org_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [org_id, name, description, user_id]
      );
      const created = res.rows[0];

      await logActivity(client, org_id, user_id, created.id, 'created', { name });
      return created;
    });

    // Invalidate cache
    await cache.del(`org:${org_id}:projects`);

    return reply.code(201).send(newProject);
  });

  // GET / (Viewer or higher)
  fastify.get('/', {
    preHandler: fastify.requireRole('viewer')
  }, async (request, reply) => {
    const { org_id } = request.user;
    const cacheKey = `org:${org_id}:projects`;

    // Try cache first
    const cachedProjects = await cache.get(cacheKey);
    if (cachedProjects) {
      fastify.log.info('CACHE HIT projects');
      return reply.send(cachedProjects);
    }

    fastify.log.info('CACHE MISS projects');
    const projects = await db.query(
      'SELECT id, name, description, status, created_at FROM projects WHERE org_id = $1 ORDER BY created_at DESC',
      [org_id]
    );

    // Populate cache with TTL of 5 minutes (300 seconds)
    await cache.set(cacheKey, projects, 300);

    return reply.send(projects);
  });

  // GET /:id (Viewer or higher)
  fastify.get('/:id', {
    preHandler: fastify.requireRole('viewer')
  }, async (request, reply) => {
    const { org_id } = request.user;
    const { id } = request.params as any;

    const projects = await db.query(
      'SELECT * FROM projects WHERE id = $1 AND org_id = $2',
      [id, org_id]
    );

    if (projects.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    return reply.send(projects[0]);
  });

  // PATCH /:id (Requires member role or higher)
  fastify.patch('/:id', {
    preHandler: fastify.requireRole('member'),
    schema: {

      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived'] }
        },
        minProperties: 1,
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as { id: string };
    const updates = request.body as {
      name?: string;
      description?: string;
      status?: 'active' | 'archived';
    };

    try {
      const updated = await withTransaction(async (client) => {
        // Verify the project belongs to the authenticated user's organization.
        const check = await client.query(
            'SELECT id FROM projects WHERE id = $1 AND org_id = $2',
            [id, org_id]
        );

        if (check.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        // Only explicitly permitted fields can become SQL column names.
        const columnByField: Record<string, string> = {
          name: 'name',
          description: 'description',
          status: 'status'
        };

        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          const column = columnByField[key];

          if (!column) {
            throw new Error(`UNSUPPORTED_FIELD:${key}`);
          }

          values.push(value);
          setClauses.push(`${column} = $${values.length}`);
        }

        const projectIdParam = values.length + 1;
        const orgIdParam = values.length + 2;

        values.push(id, org_id);

        const res = await client.query(
            `UPDATE projects
             SET ${setClauses.join(', ')}
             WHERE id = $${projectIdParam}
               AND org_id = $${orgIdParam}
               RETURNING *`,
            values
        );

        await logActivity(client, org_id, user_id, id, 'updated', updates);
        return res.rows[0];
      });

      // Invalidate the organization-specific project cache.
      await cache.del(`org:${org_id}:projects`);

      return reply.send(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Project not found' });
      }
      if (message.startsWith('UNSUPPORTED_FIELD:')) {
        return reply.code(400).send({
          error: `Unsupported project field: ${message.slice('UNSUPPORTED_FIELD:'.length)}`
        });
      }
      throw err;
    }
  });

  // DELETE /:id (Requires admin role or higher)
  fastify.delete('/:id', {
    preHandler: fastify.requireRole('admin')
  }, async (request, reply) => {
    const { org_id } = request.user;
    const { id } = request.params as any;

    try {
      const orphanedKeys = await withTransaction(async (client) => {
        // Tasks (and their attachment rows) are removed by ON DELETE CASCADE, but the files in
        // object storage are not. Delete the attachment rows explicitly to learn exactly which
        // keys to clean up; if the project turns out not to exist, the rollback restores them.
        const attachments = await client.query(
          `DELETE FROM task_attachments a
            USING tasks t
            WHERE a.task_id = t.id AND t.project_id = $1 AND a.org_id = $2
            RETURNING a.storage_key`,
          [id, org_id]
        );

        const res = await client.query('DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id', [id, org_id]);
        if (res.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        return attachments.rows.map((r: { storage_key: string }) => r.storage_key);
      });

      // Only after commit, so a rolled-back delete never loses files that are still referenced.
      await deleteStoredObjects(orphanedKeys, request.log);

      await cache.del(`org:${org_id}:projects`);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Project not found' });
      }
      throw err;
    }
  });
};

export default projectRoutes;

