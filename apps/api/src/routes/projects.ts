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

  // POST /
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' }
        }
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

  // GET /
  fastify.get('/', async (request, reply) => {
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

  // GET /:id
  fastify.get('/:id', async (request, reply) => {
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

  // PATCH /:id
  fastify.patch('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          status: { type: 'string', enum: ['active', 'archived'] }
        }
      }
    }
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as any;
    const updates = request.body as any;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      // Verify ownership
      const check = await client.query('SELECT id FROM projects WHERE id = $1 AND org_id = $2', [id, org_id]);
      if (check.rows.length === 0) {
        throw new Error('NOT_FOUND');
      }

      const setClauses = [];
      const values = [];
      let i = 1;
      for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = $${i}`);
        values.push(value);
        i++;
      }
      values.push(id, org_id);

      const res = await client.query(
        `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${i-2} AND org_id = $${i-1} RETURNING *`,
        values
      );

      await logActivity(client, org_id, user_id, id, 'updated', updates);
      await client.query('COMMIT');

      // Invalidate cache
      await cache.del(`org:${org_id}:projects`);

      return reply.send(res.rows[0]);
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.message === 'NOT_FOUND') return reply.code(404).send({ error: 'Project not found' });
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /:id
  fastify.delete('/:id', async (request, reply) => {
    const { org_id, role } = request.user;
    const { id } = request.params as any;

    if (role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can delete projects' });
    }

    const res = await db.query('DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id', [id, org_id]);
    
    if (res.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    await cache.del(`org:${org_id}:projects`);
    return reply.code(204).send();
  });
};

export default projectRoutes;
