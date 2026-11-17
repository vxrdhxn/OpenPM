import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { deleteStoredObjects } from '../attachments/cleanup';
import { clearSessionCookie } from '../plugins/session';
import { verifyPassword } from '../security/passwords';

const ORG_COLUMNS = 'id, name, slug, created_at, updated_at';

class OrganizationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * The caller's own organization: its settings, and deleting it. Always the organization in the
 * session; there is no organization id in any URL.
 */
const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // GET / — everyone in the organization can see its name and slug.
  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request, reply) => {
    const [org] = await db.query(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = $1`, [request.user.org_id]);
    if (!org) return reply.code(404).send({ error: 'Organization not found' });
    return org;
  });

  // PATCH / — rename. The slug never changes: it was chosen at sign-up and identifies the workspace
  // when deleting it.
  fastify.patch('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 2, maxLength: 255, pattern: '\\S' } },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { org_id, user_id } = request.user;
    const name = (request.body as { name: string }).name.trim();

    return withTransaction(async (client) => {
      const before = await client.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1 FOR UPDATE', [org_id]);
      const res = await client.query(
        `UPDATE organizations SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING ${ORG_COLUMNS}`,
        [name, org_id]
      );
      if (before.rows[0]?.name !== name) {
        await client.query(
          'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
          [org_id, user_id, 'organization', org_id, 'renamed', JSON.stringify({ from: before.rows[0]?.name, to: name })]
        );
      }
      return res.rows[0];
    });
  });

  // DELETE / — delete the organization and everything in it: members, projects, tasks, comments,
  // labels, notifications, invites, activity and attachment files. Owners only, and only with the
  // workspace slug typed out and the owner's password, so it cannot happen by a stray click or from
  // a stolen session alone. There is no undo.
  fastify.delete('/', {
    preHandler: fastify.requireRole('owner'),
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['confirm_slug', 'password'],
        properties: {
          confirm_slug: { type: 'string', maxLength: 255 },
          password: { type: 'string', maxLength: 1024 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { confirm_slug, password } = request.body as { confirm_slug: string; password: string };

    try {
      const keys = await withTransaction(async (client) => {
        const org = await client.query<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1 FOR UPDATE', [org_id]);
        if (org.rows.length === 0) throw new OrganizationError(404, 'Organization not found');
        if (confirm_slug.trim() !== org.rows[0]!.slug) {
          throw new OrganizationError(400, 'Type the workspace slug exactly to confirm.');
        }

        const me = await client.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
          [user_id, org_id]
        );
        if (!(await verifyPassword(password, me.rows[0]?.password_hash))) {
          throw new OrganizationError(403, 'Your password is incorrect.');
        }

        // Files live in object storage, outside the database cascade: collect their keys first.
        const files = await client.query<{ storage_key: string }>('SELECT storage_key FROM task_attachments WHERE org_id = $1', [org_id]);
        // Every table references organizations ON DELETE CASCADE, so this removes all of its data.
        await client.query('DELETE FROM organizations WHERE id = $1', [org_id]);
        return files.rows.map((r) => r.storage_key);
      });

      // After the commit, as for project deletion: a storage failure leaves (logged) orphaned files,
      // never data that points at deleted files.
      await deleteStoredObjects(keys, request.log);
      request.log.warn({ event: 'organization_deleted', org_id, user_id, files: keys.length }, 'Organization deleted');

      // Members' tokens now fail (their users are gone); open WebSockets close at the next heartbeat.
      clearSessionCookie(reply);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof OrganizationError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
};

export default organizationRoutes;
