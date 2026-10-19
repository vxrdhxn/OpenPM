import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
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

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        'INSERT INTO projects (org_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [org_id, name, description, user_id]
      );
      const newProject = res.rows[0];

      await logActivity(client, org_id, user_id, newProject.id, 'created', { name });
      await client.query('COMMIT');

      // Invalidate cache
      await cache.del(`org:${org_id}:projects`);

      return reply.code(201).send(newProject);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // Verify the project belongs to the authenticated user's organization.
      const check = await client.query(
          'SELECT id FROM projects WHERE id = $1 AND org_id = $2',
          [id, org_id]
      );

      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Project not found' });
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
          await client.query('ROLLBACK');
          return reply.code(400).send({
            error: `Unsupported project field: ${key}`
          });
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
      await client.query('COMMIT');

      // Invalidate the organization-specific project cache.
      await cache.del(`org:${org_id}:projects`);

      return reply.send(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /:id (Requires admin role or higher)
  fastify.delete('/:id', {
    preHandler: fastify.requireRole('admin')
  }, async (request, reply) => {
    const { org_id } = request.user;
    const { id } = request.params as any;

    const res = await db.query('DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id', [id, org_id]);
    
    if (res.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    await cache.del(`org:${org_id}:projects`);
    return reply.code(204).send();
  });
};

export default projectRoutes;

