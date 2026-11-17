import { FastifyPluginAsync } from 'fastify';
import { hashPassword, verifyPassword } from '../security/passwords';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { authFailuresTotal } from '../metrics';
import { clearSessionCookie, issueSession, revokeSessions } from '../plugins/session';
import { generateToken, hashToken, TOKEN_PATTERN } from '../security/tokens';
import { enqueue } from '../jobs/enqueue';
import { audit, auditBestEffort, originOf, type RequestOrigin } from '../security/audit';

export const REGISTER_CONFLICT =
  'Could not create the account. Try a different organization URL, or sign in if you already have an account.';

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

        const passwordHash = await hashPassword(password);

        // Create organization
        const orgRes = await client.query(
          'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
          [org_name, org_slug]
        );
        const orgId = orgRes.rows[0].id;

        // The person who creates a workspace owns it (only owners can transfer or delete it).
        const userRes = await client.query(
          'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [orgId, normalizedEmail, passwordHash, name, 'owner']
        );

        const userId: string = userRes.rows[0].id;
        await audit(client, originOf(request), {
          orgId, actorId: userId, action: 'auth.registered', targetType: 'organization', targetId: orgId, metadata: { slug: org_slug },
        });
        return { orgId, userId };
      });

      const token = issueSession(fastify, reply, { user_id: userId, org_id: orgId, role: 'owner', tv: 0 });

      return reply.code(201).send({ token });
    } catch (err: any) {
      // One answer for both conflicts, so the response does not say whether an email is registered.
      // (Registration still fails where it would otherwise succeed; fully hiding that needs a
      // verify-by-email sign-up. Rate-limited to 10/min per client.)
      if (err.message === 'SLUG_TAKEN' || err.message === 'EMAIL_TAKEN') {
        authFailuresTotal.inc({ reason: 'register_conflict' });
        return reply.code(409).send({ error: REGISTER_CONFLICT });
      }
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

    const users = await db.query('SELECT id, org_id, role, password_hash, token_version FROM users WHERE email = $1 AND deactivated_at IS NULL', [normalizedEmail]);

    // Always one full bcrypt comparison (against a dummy hash for an unknown email), so the response
    // time does not reveal whether the account exists.
    const user = users[0];
    const match = await verifyPassword(password, user?.password_hash);

    if (!user || !match) {
      // A wrong password for a real account is audited for that workspace's admins. Not awaited: the
      // extra write must not make "account exists" answer slower than "no such account".
      if (user) {
        void auditBestEffort(originOf(request), {
          orgId: user.org_id, actorId: null, action: 'auth.login_failed', targetType: 'user', targetId: user.id,
        }, request.log);
      }
      return rejectLogin();
    }

    const token = issueSession(fastify, reply, {
      user_id: user.id,
      org_id: user.org_id,
      role: user.role,
      tv: user.token_version ?? 0,
    });
    await auditBestEffort(originOf(request), {
      orgId: user.org_id, actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id,
    }, request.log);

    return reply.send({ token });
  });

  // Current user, from the verified token (role as stored now; see plugins/auth.ts)
  fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, org_id, role } = request.user;
    return reply.send({ user: { user_id, org_id, role } });
  });

  // Logout: clears the cookie and, when the caller is signed in, ends ALL of their sessions (every
  // device), so a copied or stolen token stops working too. Always succeeds, signed in or not.
  fastify.post('/logout', async (request, reply) => {
    const check = await fastify.verifySession(request);
    if (check.ok) {
      await revokeSessions(request.user.user_id);
      request.log.info({ event: 'logout', user_id: request.user.user_id }, 'Sessions revoked on logout');
      const { org_id, user_id } = request.user;
      await auditBestEffort(originOf(request), { orgId: org_id, actorId: user_id, action: 'auth.logout', targetType: 'user', targetId: user_id }, request.log);
    }
    clearSessionCookie(reply);
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
    void issuePasswordResetLink(normalizedEmail, request.id, originOf(request)).catch((err) => {
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
        const passwordHash = await hashPassword(password);

        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        // Whoever had the old password (or a stolen session) is signed out everywhere.
        await revokeSessions(userId, client);
        // Consumes this link and any other outstanding ones for the user.
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await client.query(
          'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
          [orgId, userId, 'user', userId, 'password_reset', '{}']
        );
        await audit(client, originOf(request), { orgId, actorId: null, action: 'auth.password_reset', targetType: 'user', targetId: userId });
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
export async function issuePasswordResetLink(email: string, requestId: string, origin: RequestOrigin | null = null): Promise<void> {
  const { token, tokenHash } = generateToken();

  const userId = await withTransaction(async (client) => {
    const users = await client.query('SELECT id, org_id FROM users WHERE email = $1', [email]);
    if (users.rows.length === 0) return null;

    const id: string = users.rows[0].id;
    await audit(client, origin, { orgId: users.rows[0].org_id, actorId: null, action: 'auth.password_reset_requested', targetType: 'user', targetId: id });
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [id]);
    await client.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS)]
    );
    return id;
  });

  if (!userId) return;

  await enqueue(
    'password_reset_requested',
    { user_id: userId, token, request_id: requestId },
    { removeOnComplete: true, removeOnFail: { age: RESET_TOKEN_TTL_MS / 1000 } }
  );
}

export default authRoutes;
