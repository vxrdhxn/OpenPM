import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { db } from '../db/client';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Register: Create Org + User
  fastify.post('/register', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['org_name', 'org_slug', 'email', 'password', 'name'],
        properties: {
          org_name: { type: 'string', minLength: 2 },
          org_slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name: { type: 'string', minLength: 2 },
        }
      }
    }
  }, async (request, reply) => {
    const { org_name, org_slug, email, password, name } = request.body as any;
    
    const normalizedEmail = email.toLowerCase().trim();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Check slug uniqueness
      const orgCheck = await client.query('SELECT id FROM organizations WHERE slug = $1', [org_slug]);
      if (orgCheck.rows.length > 0) {
        throw new Error('SLUG_TAKEN');
      }

      // Check email uniqueness
      const emailCheck = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (emailCheck.rows.length > 0) {
        throw new Error('EMAIL_TAKEN');
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Create organization
      const orgRes = await client.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        [org_name, org_slug]
      );
      const orgId = orgRes.rows[0].id;

      // Create user
      const userRes = await client.query(
        'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [orgId, normalizedEmail, passwordHash, name, 'admin']
      );
      const userId = userRes.rows[0].id;

      await client.query('COMMIT');

      // Sign JWT
      const token = fastify.jwt.sign(
        { user_id: userId, org_id: orgId, role: 'admin' },
        { expiresIn: '24h' }
      );

      // Set cookie
      reply.setCookie('auth_token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60, // 24 hours
      });

      return reply.code(201).send({ token });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.message === 'SLUG_TAKEN') return reply.code(409).send({ error: 'Organization slug is already taken' });
      if (err.message === 'EMAIL_TAKEN') return reply.code(409).send({ error: 'Email is already registered' });
      throw err;
    } finally {
      client.release();
    }
  });

  // Login
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body as any;
    const normalizedEmail = email.toLowerCase().trim();

    const users = await db.query('SELECT id, org_id, role, password_hash FROM users WHERE email = $1', [normalizedEmail]);
    
    if (users.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      { user_id: user.id, org_id: user.org_id, role: user.role },
      { expiresIn: '24h' }
    );

    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60,
    });

    return reply.send({ token });
  });

  // Get current user details (Stateless, from JWT)
  fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    // Decoding JWT provides identity without DB lookup
    return reply.send({ user: request.user });
  });

  // Logout
  fastify.post('/logout', async (_request, reply) => {
    reply.setCookie('auth_token', '', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0, // Delete immediately
    });
    return reply.send({ success: true });
  });
};

export default authRoutes;
