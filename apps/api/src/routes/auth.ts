import { FastifyPluginAsync } from 'fastify';
import { clearSessionCookie, issueSession, revokeSessions } from '../plugins/session';
import { TOKEN_PATTERN } from '../security/tokens';
import { auditBestEffort, originOf } from '../security/audit';
import * as authService from '../services/auth';
import type { Registration } from '../services/auth';

/** /api/auth: sign-up, sign-in, sign-out and password reset. Rules: services/auth.ts. */

export { REGISTER_CONFLICT, issuePasswordResetLink } from '../services/auth';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Create an organization and its owner.
  fastify.post<{ Body: Registration }>('/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
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
        },
      },
    },
  }, async (request, reply) => {
    const claims = await authService.register(request.body, originOf(request));
    const token = issueSession(fastify, reply, claims);
    return reply.code(201).send({ token });
  });

  fastify.post<{ Body: { email: string; password: string } }>('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const claims = await authService.login(request.body.email, request.body.password, originOf(request), request.log);
    const token = issueSession(fastify, reply, claims);
    return reply.send({ token });
  });

  // Current user, from the verified token (role as stored now; see plugins/auth.ts).
  fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request) => {
    const { user_id, org_id, role } = request.user;
    return { user: { user_id, org_id, role } };
  });

  // Clears the cookie and, when the caller is signed in, ends ALL of their sessions (every device), so
  // a copied or stolen token stops working too. Always succeeds, signed in or not.
  fastify.post('/logout', async (request, reply) => {
    const check = await fastify.verifySession(request);
    if (check.ok) {
      const { org_id, user_id } = request.user;
      await revokeSessions(user_id);
      request.log.info({ event: 'logout', user_id }, 'Sessions revoked on logout');
      await auditBestEffort(originOf(request), { orgId: org_id, actorId: user_id, action: 'auth.logout', targetType: 'user', targetId: user_id }, request.log);
    }
    clearSessionCookie(reply);
    return reply.send({ success: true });
  });

  // Email a single-use reset link if the address is registered.
  fastify.post<{ Body: { email: string } }>('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    // Reply first, then do the work. If the lookup, insert and enqueue ran before replying, a
    // registered address would answer measurably slower than an unknown one (account enumeration).
    // Failures are logged; the caller can't be told anyway without revealing whether the address exists.
    void authService.issuePasswordResetLink(request.body.email.toLowerCase().trim(), request.id, originOf(request)).catch((err) => {
      request.log.error({ err }, 'Could not issue password reset link');
    });
    return reply.send({ success: true, message: 'If that email is registered, a reset link was sent.' });
  });

  // Consume a reset token and set a new password.
  fastify.post<{ Body: { token: string; password: string } }>('/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', pattern: TOKEN_PATTERN },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    await authService.resetPassword(request.body.token, request.body.password, originOf(request));
    return { success: true };
  });
};

export default authRoutes;
