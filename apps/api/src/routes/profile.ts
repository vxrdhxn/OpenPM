import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import bcrypt from 'bcrypt';

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // GET /me
  fastify.get('/me', async (request, reply) => {
    const { user_id } = request.user;
    
    const users = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [user_id]
    );

    if (users.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send(users[0]);
  });

  // PATCH /me
  fastify.patch('/me', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (request, reply) => {
    const { user_id } = request.user;
    const updates = request.body as any;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    const setClauses = [];
    const values = [];
    let i = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'password') {
        const hash = await bcrypt.hash(value as string, 12);
        setClauses.push(`password_hash = $${i}`);
        values.push(hash);
      } else {
        setClauses.push(`${key} = $${i}`);
        values.push(value);
      }
      i++;
    }
    values.push(user_id);

    const res = await db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${i-1} RETURNING id, name, email, role`,
      values
    );

    if (res.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send(res[0]);
  });
};

export default profileRoutes;
