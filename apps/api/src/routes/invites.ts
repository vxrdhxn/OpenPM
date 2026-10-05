import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import crypto from 'crypto';

const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // POST / (Requires admin role or higher)
  fastify.post('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['member', 'admin'], default: 'member' }
        }
      }
    }
  }, async (request, reply) => {
    const { org_id } = request.user;
    const { email, role } = request.body as any;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const client = await db.getClient();
    try {
      const res = await client.query(
        'INSERT INTO organization_invites (org_id, email, token, role, expires_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, email) DO UPDATE SET token = $3, expires_at = $5 RETURNING *',
        [org_id, email, token, role || 'member', expiresAt]
      );
      
      return reply.code(201).send(res.rows[0]);
    } finally {
      client.release();
    }
  });

  // GET / (Requires admin role or higher)
  fastify.get('/', {
    preHandler: fastify.requireRole('admin')
  }, async (request, reply) => {
    const { org_id } = request.user;

    const res = await db.query(
      'SELECT id, email, role, expires_at, created_at FROM organization_invites WHERE org_id = $1 ORDER BY created_at DESC',
      [org_id]
    );

    return reply.send(res);
  });

  // DELETE /:id (Requires admin role or higher)
  fastify.delete('/:id', {
    preHandler: fastify.requireRole('admin')
  }, async (request, reply) => {
    const { org_id } = request.user;
    const { id } = request.params as any;

    const res = await db.query(
      'DELETE FROM organization_invites WHERE id = $1 AND org_id = $2 RETURNING id',
      [id, org_id]
    );

    if (res.length === 0) {
      return reply.code(404).send({ error: 'Invite not found' });
    }

    return reply.code(204).send();
  });
};

export default inviteRoutes;

