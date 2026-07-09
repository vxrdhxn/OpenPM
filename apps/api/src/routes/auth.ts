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

  // Forgot Password
  fastify.post('/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    const { email } = request.body as any;
    const normalizedEmail = email.toLowerCase().trim();

    const users = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (users.length > 0) {
      const userId = users[0].id;
      const { randomBytes } = await import('crypto');
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

      await db.query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, expiresAt]
      );
      
      // In a real app, send an email with the token here using BullMQ job
    }

    // Always return success to prevent email enumeration
    return reply.send({ success: true, message: 'If that email is registered, a reset link was sent.' });
  });

  // Reset Password
  fastify.post('/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string' },
          password: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (request, reply) => {
    const { token, password } = request.body as any;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const tokens = await client.query(
        'SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1',
        [token]
      );

      if (tokens.length === 0 || tokens[0].expires_at < new Date()) {
        throw new Error('INVALID_TOKEN');
      }

      const userId = tokens[0].user_id;
      const passwordHash = await bcrypt.hash(password, 12);

      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);

      await client.query('COMMIT');
      return reply.send({ success: true });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.message === 'INVALID_TOKEN') {
        return reply.code(400).send({ error: 'Invalid or expired reset token' });
      }
      throw err;
    } finally {
      client.release();
    }
  });
};

export default authRoutes;
