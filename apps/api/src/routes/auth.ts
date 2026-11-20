import { FastifyPluginAsync } from 'fastify';
import { clearSessionCookie, issueSession, revokeSessions } from '../plugins/session';
import { TOKEN_PATTERN } from '../security/tokens';
import { auditBestEffort, originOf } from '../security/audit';
import * as authService from '../services/auth';
import { signupNeedsVerification } from '../config';
import type { LoginDoor, Registration } from '../services/auth';
import { LOGIN_DOORS } from '../wire';

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
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!signupNeedsVerification()) {
      const claims = await authService.register(request.body, originOf(request));
      const token = issueSession(fastify, reply, claims);
      return reply.code(201).send({ token });
    }

    // Verify-by-email (docs/signup.md). Only the organization URL is checked before replying; the
    // rest depends on whether the address has an account, so it runs after the reply, like
    // forgot-password, and every address gets the same 202.
    await authService.checkSignupSlug(request.body.org_slug);
    void authService.sendSignupLink(request.body, request.id).catch((err) => {
      request.log.error({ err }, 'Could not send the sign-up link');
    });
    return reply.code(202).send({ verification: 'email', message: 'Check your email for a link to finish creating your workspace.' });
  });

  // Finish a verified sign-up from the emailed link: creates the workspace and signs its owner in.
  fastify.post<{ Body: { token: string } }>('/verify-signup', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', pattern: TOKEN_PATTERN } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const claims = await authService.completeSignup(request.body.token, originOf(request));
    const token = issueSession(fastify, reply, claims);
    return reply.code(201).send({ token });
  });

  // `as: 'admin'` is the admin sign-in: it lets in only workspace owners and admins (services/auth.ts).
  fastify.post<{ Body: { email: string; password: string; as?: LoginDoor } }>('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
          as: { type: 'string', enum: [...LOGIN_DOORS] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, password, as: door = 'member' } = request.body;
    const claims = await authService.login(email, password, originOf(request), request.log, door);
    const token = issueSession(fastify, reply, claims);
    // The role tells the app where to go next (the admin area or the dashboard).
    return reply.send({ token, role: claims.role });
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
