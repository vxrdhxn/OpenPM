import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { deleteStoredObjects } from '../attachments/cleanup';
import { cache } from '../cache/redis';
import { seesAllProjects, unassignWithoutAccess, VISIBILITIES, visibleProjectSql, type Visibility } from '../security/projectAccess';
import { announceAccessChange } from './projectMembers';
import {
  Conditions,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  likePattern,
  paginationQuerySchema,
  searchQuerySchema,
  toPage,
} from '../query/pagination';

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
          description: { type: 'string' },
          visibility: { type: 'string', enum: [...VISIBILITIES] }
        },
        minProperties: 1,
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { name, description, visibility = 'workspace' } = request.body as { name: string; description?: string; visibility?: Visibility };
    const { org_id, user_id } = request.user;

    const newProject = await withTransaction(async (client) => {
      const res = await client.query(
        'INSERT INTO projects (org_id, name, description, created_by, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [org_id, name, description, user_id, visibility]
      );
      const created = res.rows[0];
      // The creator is a member, so a private project stays theirs (even if they are later demoted).
      await client.query('INSERT INTO project_members (project_id, user_id, org_id, added_by) VALUES ($1, $2, $3, $2)', [created.id, user_id, org_id]);

      await logActivity(client, org_id, user_id, created.id, 'created', { name, visibility });
      return created;
    });

    // Invalidate cache
    await cache.del(`org:${org_id}:projects`);
    if (visibility === 'private') await announceAccessChange(org_id, newProject.id);

    return reply.code(201).send(newProject);
  });

  // GET / (Viewer or higher): newest first, paginated, optionally searched by name and filtered by status.
  // Response: { items, next_cursor } (see query/pagination.ts).
  fastify.get('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...paginationQuerySchema,
          q: searchQuerySchema,
          status: { type: 'string', enum: ['active', 'archived'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, role } = request.user;
    const { limit, cursor, q, status } = request.query as { limit: number; cursor?: string; q?: string; status?: string };

    // Only the plain first page is cached (it is what the projects page loads); every write clears it.
    // Only for admins and owners: they see every project, so one cached list is right for all of
    // them. Everyone else gets the list filtered for them (private projects), straight from Postgres.
    const cacheable = seesAllProjects(role) && !cursor && !q && !status && limit === DEFAULT_PAGE_SIZE;
    const cacheKey = `org:${org_id}:projects`;
    if (cacheable) {
      const cached = await cache.get(cacheKey);
      if (cached) return reply.send(cached);
    }

    const where = new Conditions().add((p) => `p.org_id = ${p(org_id)}`).add((p) => visibleProjectSql('p', request.user, p));
    if (status) where.add((p) => `p.status = ${p(status)}`);
    if (q) where.add((p) => `p.name ILIKE ${p(likePattern(q))} ESCAPE '\\'`);
    if (cursor) {
      const after = decodeCursor(cursor);
      where.add((p) => `(p.created_at, p.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
    }

    const rows = await db.query(
      `SELECT p.id, p.name, p.description, p.status, p.visibility, p.created_at, p.created_at::text AS sort_key
         FROM projects p
        WHERE ${where.sql()}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${where.param(limit + 1)}`,
      where.params
    );
    const page = toPage(rows, limit);

    if (cacheable) await cache.set(cacheKey, page, 300); // 5 minutes
    return reply.send(page);
  });

  // GET /:id (Viewer or higher). Private projects: the gate in app.ts answers 404 to non-members.
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
          status: { type: 'string', enum: ['active', 'archived'] },
          visibility: { type: 'string', enum: [...VISIBILITIES] }
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
      visibility?: Visibility;
    };
    let accessChanged = false;
    let unassigned = 0;

    try {
      const updated = await withTransaction(async (client) => {
        // Verify the project belongs to the authenticated user's organization (locked: visibility).
        const check = await client.query<{ visibility: Visibility; created_by: string }>(
            'SELECT id, visibility, created_by FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE',
            [id, org_id]
        );

        if (check.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        accessChanged = updates.visibility !== undefined && updates.visibility !== check.rows[0]!.visibility;
        // Changing who can see a shared project is for admins, owners and whoever created it, so a
        // member cannot hide a project from the rest of the team.
        if (accessChanged && !seesAllProjects(request.user.role) && check.rows[0]!.created_by !== user_id) {
          throw new Error('VISIBILITY_FORBIDDEN');
        }

        // Only explicitly permitted fields can become SQL column names.
        const columnByField: Record<string, string> = {
          name: 'name',
          description: 'description',
          status: 'status',
          visibility: 'visibility'
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
             SET ${setClauses.join(', ')}, updated_at = NOW()
             WHERE id = $${projectIdParam}
               AND org_id = $${orgIdParam}
               RETURNING *`,
            values
        );

        if (accessChanged && updates.visibility === 'private') {
          // Whoever makes it private keeps it; assignees who can no longer see it are unassigned.
          await client.query(
            `INSERT INTO project_members (project_id, user_id, org_id, added_by) VALUES ($1, $2, $3, $2)
             ON CONFLICT (project_id, user_id) DO NOTHING`,
            [id, user_id, org_id]
          );
          unassigned = await unassignWithoutAccess(client, org_id, id);
        }

        await logActivity(client, org_id, user_id, id, 'updated', unassigned ? { ...updates, unassigned } : updates);
        return res.rows[0];
      });

      // Invalidate the organization-specific project cache.
      await cache.del(`org:${org_id}:projects`);
      if (unassigned > 0) await cache.del(`org:${org_id}:project:${id}:tasks`);
      if (accessChanged) await announceAccessChange(org_id, id);

      return reply.send(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Project not found' });
      }
      if (message === 'VISIBILITY_FORBIDDEN') {
        return reply.code(403).send({ error: 'Only admins, owners and the project creator can change who sees a project.' });
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
    const { org_id, user_id } = request.user;
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

        const res = await client.query('DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id, name', [id, org_id]);
        if (res.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        // Audit trail (activity_log rows are not tied to the project, so this survives the delete).
        await logActivity(client, org_id, user_id, id, 'deleted', { name: res.rows[0].name });

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

