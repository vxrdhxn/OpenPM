import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { authFailuresTotal } from '../metrics';
import { issueSession } from '../plugins/session';
import { generateToken, hashToken, TOKEN_PATTERN } from '../security/tokens';
import { getJobQueue } from '../queue';

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

    try {
      const { orgId, userId } = await withTransaction(async (client) => {
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

        return { orgId, userId: userRes.rows[0].id };
      });

      const token = issueSession(fastify, reply, { user_id: userId, org_id: orgId, role: 'admin' });

      return reply.code(201).send({ token });
    } catch (err: any) {
      if (err.message === 'SLUG_TAKEN') return reply.code(409).send({ error: 'Organization slug is already taken' });
      if (err.message === 'EMAIL_TAKEN') return reply.code(409).send({ error: 'Email is already registered' });
      throw err;
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

    // One reason for both "no such user" and "wrong password", in the response AND in metrics/logs,
    // so nothing observable distinguishes the two. The email address is deliberately not recorded.
    const rejectLogin = () => {
      authFailuresTotal.inc({ reason: 'bad_credentials' });
      request.log.warn({ event: 'login_failed', reason: 'bad_credentials' }, 'Login failed');
      return reply.code(401).send({ error: 'Invalid credentials' });
    };

    const users = await db.query('SELECT id, org_id, role, password_hash FROM users WHERE email = $1', [normalizedEmail]);

    if (users.length === 0) {
      return rejectLogin();
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return rejectLogin();
    }

    const token = issueSession(fastify, reply, { user_id: user.id, org_id: user.org_id, role: user.role });

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

  // Forgot Password: email a single-use reset link if the address is registered.
  fastify.post('/forgot-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const normalizedEmail = email.toLowerCase().trim();

    // Reply first, then do the work. If the lookup, insert and enqueue ran before replying, a
    // registered address would answer measurably slower than an unknown one (account enumeration).
    // Failures are logged; the caller can't be told anyway without revealing whether the address exists.
    void issuePasswordResetLink(normalizedEmail, request.id).catch((err) => {
      request.log.error({ err }, 'Could not issue password reset link');
    });

    return reply.send({ success: true, message: 'If that email is registered, a reset link was sent.' });
  });

  // Reset Password: consume a reset token and set a new password.
  fastify.post('/reset-password', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', pattern: TOKEN_PATTERN },
          password: { type: 'string', minLength: 8 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string };

    try {
      await withTransaction(async (client) => {
        // FOR UPDATE: the same link can't be used twice concurrently.
        const tokenRes = await client.query(
          `SELECT t.user_id, u.org_id
             FROM password_reset_tokens t
             JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = $1 AND t.expires_at > NOW()
            FOR UPDATE OF t`,
          [hashToken(token)]
        );

        if (tokenRes.rows.length === 0) {
          throw new Error('INVALID_TOKEN');
        }

        const { user_id: userId, org_id: orgId } = tokenRes.rows[0];
        const passwordHash = await bcrypt.hash(password, 12);

        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        // Consumes this link and any other outstanding ones for the user.
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await client.query(
          'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, userId, 'user', userId, 'password_reset', '{}']
        );
      });

      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_TOKEN') {
        return reply.code(400).send({ error: 'Invalid or expired reset token' });
      }
      throw err;
    }
  });
};

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a reset token for the user with this email (if any) and queue the email that delivers it.
 * Earlier links for the user are invalidated, so only the newest one works. The database keeps only
 * the token's hash; the raw token goes into the job, which is removed from Redis once it completes.
 */
export async function issuePasswordResetLink(email: string, requestId: string): Promise<void> {
  const { token, tokenHash } = generateToken();

  const userId = await withTransaction(async (client) => {
    const users = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (users.rows.length === 0) return null;

    const id: string = users.rows[0].id;
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [id]);
    await client.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS)]
    );
    return id;
  });

  if (!userId) return;

  await getJobQueue().add(
    'password_reset_requested',
    { user_id: userId, token, request_id: requestId },
    { removeOnComplete: true, removeOnFail: { age: RESET_TOKEN_TTL_MS / 1000 } }
  );
}

export default authRoutes;
