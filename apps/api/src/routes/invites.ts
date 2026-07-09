import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import crypto from 'crypto';

const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // POST /
  fastify.post('/', {
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
    const { org_id, role: userRole } = request.user;
    const { email, role } = request.body as any;

    if (userRole !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can invite users' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const client = await db.getClient();
    try {
      const res = await client.query(
        'INSERT INTO organization_invites (org_id, email, token, role, expires_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (org_id, email) DO UPDATE SET token = $3, expires_at = $5 RETURNING *',
        [org_id, email, token, role || 'member', expiresAt]
      );
      
      // Here you would typically enqueue an email job, e.g., using BullMQ
      // await inviteQueue.add('send_invite', { email, token, org_id });

      return reply.code(201).send(res.rows[0]);
    } finally {
      client.release();
    }
  });

  // GET /
  fastify.get('/', async (request, reply) => {
    const { org_id } = request.user;

    const res = await db.query(
      'SELECT id, email, role, expires_at, created_at FROM organization_invites WHERE org_id = $1 ORDER BY created_at DESC',
      [org_id]
    );

    return reply.send(res);
  });

  // DELETE /:id
  fastify.delete('/:id', async (request, reply) => {
    const { org_id, role } = request.user;
    const { id } = request.params as any;

    if (role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can delete invites' });
    }

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
