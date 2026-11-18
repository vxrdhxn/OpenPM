import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { TOKEN_PATTERN } from '../security/tokens';
import { issueSession } from '../plugins/session';
import { originOf } from '../security/audit';
import * as inviteService from '../services/invites';

/** /api/invites. Rules: services/invites.ts. */

const tokenProperty = { type: 'string', pattern: TOKEN_PATTERN } as const;
const tokenBody = {
  type: 'object',
  required: ['token'],
  properties: { token: tokenProperty },
  additionalProperties: false,
} as const;

const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Admin routes (authenticated) ─────────────────────────────────────────────
  await fastify.register(async (admin) => {
    admin.addHook('preValidation', admin.authenticate);

    // Invite someone to the caller's organization and email them a link.
    admin.post<{ Body: { email: string; role: string } }>('/', {
      preHandler: admin.requireRole('admin'),
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['member', 'admin'], default: 'member' },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const invite = await inviteService.createInvite(scopeOf(request.user), request.body.email, request.body.role ?? 'member', originOf(request), request.log);
      return reply.code(201).send(invite);
    });

    // Pending invites for the caller's organization.
    admin.get('/', { preHandler: admin.requireRole('admin') }, async (request) => inviteService.listInvites(scopeOf(request.user)));

    // Revoke an invite.
    admin.delete<{ Params: { id: string } }>('/:id', {
      preHandler: admin.requireRole('admin'),
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
    }, async (request, reply) => {
      await inviteService.revokeInvite(scopeOf(request.user), request.params.id, originOf(request));
      return reply.code(204).send();
    });
  });

  // ── Public routes (the invitee has no account yet) ───────────────────────────
  // The token is sent in the body rather than the URL, so it never lands in access logs.

  // What the invite is for, so the accept page can show it.
  fastify.post<{ Body: { token: string } }>('/lookup', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { body: tokenBody },
  }, async (request) => inviteService.lookupInvite(request.body.token));

  // The invitee says no.
  fastify.post<{ Body: { token: string } }>('/decline', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: tokenBody },
  }, async (request, reply) => {
    await inviteService.declineInvite(request.body.token, originOf(request), request.log);
    return reply.code(204).send();
  });

  // Create the invitee's account in the inviting organization and sign them in.
  fastify.post<{ Body: { token: string; name: string; password: string } }>('/accept', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'name', 'password'],
        properties: {
          token: tokenProperty,
          name: { type: 'string', minLength: 2 },
          password: { type: 'string', minLength: 8 },
        },
        // The organization, role and email all come from the invite, never from the request.
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const claims = await inviteService.acceptInvite(request.body.token, request.body.name, request.body.password, originOf(request));
    const sessionToken = issueSession(fastify, reply, claims);
    return reply.code(201).send({ token: sessionToken });
  });
};

export default inviteRoutes;
