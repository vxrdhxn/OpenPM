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
        },
        // Only name/password are self-editable. Unknown keys (role, org_id, email, ...) must be
        // rejected: the app runs Ajv with removeAdditional: false, so they are not stripped.
        minProperties: 1,
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { user_id } = request.user;
    const { name, password } = request.body as { name?: string; password?: string };

    // Each column is written out explicitly; no request key ever becomes SQL text.
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      values.push(name);
      setClauses.push(`name = $${values.length}`);
    }
    if (password !== undefined) {
      values.push(await bcrypt.hash(password, 12));
      setClauses.push(`password_hash = $${values.length}`);
    }

    values.push(user_id);

    const res = await db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id, name, email, role`,
      values
    );

    if (res.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send(res[0]);
  });
};

export default profileRoutes;
