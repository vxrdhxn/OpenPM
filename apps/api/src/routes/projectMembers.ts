import { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { hasMinRole } from '../plugins/auth';
import { unassignWithoutAccess, userSeesProjectSql } from '../security/projectAccess';
import { audit, originOf } from '../security/audit';
import { announceAccessChange } from '../realtime/announce';

class ProjectMemberError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function logProjectActivity(client: PoolClient, orgId: string, actorId: string, projectId: string, action: string, metadata: object) {
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, actorId, 'project', projectId, action, JSON.stringify(metadata)]
  );
}


/**
 * People of a project: /api/projects/:projectId/members. The app-wide project gate (app.ts) has
 * already answered 404 to anyone who cannot see the project.
 *
 * Membership decides who sees a PRIVATE project (plus admins and owners, who see every project). It
 * is kept for workspace projects too, so making one private keeps the people already added.
 */
const projectMemberRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // GET /:projectId/members — everyone who can see the project (who can be assigned or mentioned),
  // with `member` true for those added to it explicitly.
  fastify.get('/:projectId/members', { preHandler: fastify.requireRole('viewer') }, async (request) => {
    const { org_id } = request.user;
    const { projectId } = request.params as { projectId: string };
    return db.query(
      `SELECT u.id, u.name, u.email, u.role,
              EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id) AS member
         FROM projects p
         JOIN users u ON u.org_id = p.org_id AND u.deactivated_at IS NULL
        WHERE p.id = $1 AND p.org_id = $2 AND ${userSeesProjectSql('p', 'u.id', 'u.role')}
        ORDER BY lower(u.name), u.id`,
      [projectId, org_id]
    );
  });

  // POST /:projectId/members { user_id } — add someone from the organization (members and up).
  fastify.post('/:projectId/members', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id: actorId } = request.user;
    const { projectId } = request.params as { projectId: string };
    const { user_id } = request.body as { user_id: string };

    try {
      const added = await withTransaction(async (client) => {
        const user = await client.query<{ id: string; name: string }>(
          'SELECT id, name FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
          [user_id, org_id]
        );
        if (user.rows.length === 0) throw new ProjectMemberError(400, 'Only members of your organization can be added');

        const res = await client.query(
          `INSERT INTO project_members (project_id, user_id, org_id, added_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, user_id) DO NOTHING RETURNING user_id`,
          [projectId, user_id, org_id, actorId]
        );
        if (res.rows.length > 0) {
          await logProjectActivity(client, org_id, actorId, projectId, 'member_added', { user_id, name: user.rows[0]!.name });
          await audit(client, originOf(request), {
            orgId: org_id, actorId, action: 'project.member_added', targetType: 'project', targetId: projectId,
            metadata: { user_id, name: user.rows[0]!.name },
          });
        }
        return res.rows.length > 0;
      });

      if (added) await announceAccessChange(org_id, projectId);
      return reply.code(added ? 201 : 200).send({ user_id, member: true });
    } catch (err) {
      if (err instanceof ProjectMemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /:projectId/members/:userId — remove someone (members and up), or leave yourself (anyone).
  // If they can no longer see the project, their tasks in it are unassigned.
  fastify.delete('/:projectId/members/:userId', async (request, reply) => {
    const { org_id, user_id: actorId, role } = request.user;
    const { projectId, userId } = request.params as { projectId: string; userId: string };

    if (userId !== actorId && !hasMinRole(role, 'member')) {
      return reply.code(403).send({ error: 'Forbidden: Insufficient permissions' });
    }

    const result = await withTransaction(async (client) => {
      const res = await client.query<{ name: string }>(
        `DELETE FROM project_members m USING users u
          WHERE m.project_id = $1 AND m.user_id = $2 AND m.org_id = $3 AND u.id = m.user_id
          RETURNING u.name`,
        [projectId, userId, org_id]
      );
      if (res.rows.length === 0) return null;
      const unassigned = await unassignWithoutAccess(client, org_id, projectId);
      await logProjectActivity(client, org_id, actorId, projectId, 'member_removed', { user_id: userId, name: res.rows[0]!.name, unassigned });
      await audit(client, originOf(request), {
        orgId: org_id, actorId, action: 'project.member_removed', targetType: 'project', targetId: projectId,
        metadata: { user_id: userId, name: res.rows[0]!.name, unassigned },
      });
      return { unassigned };
    });
    if (!result) return reply.code(404).send({ error: 'Not a member of this project' });

    if (result.unassigned > 0) await cache.del(`org:${org_id}:project:${projectId}:tasks`);
    await announceAccessChange(org_id, projectId);
    return reply.code(204).send();
  });
};

export default projectMemberRoutes;
