import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as profiles from '../data/profile';
import { NotFoundError } from '../domain/errors';
import { hashPassword } from '../security/passwords';
import { issueSession } from '../plugins/session';
import { auditBestEffort, originOf } from '../security/audit';

/** /api/profile/me: the caller's own account (data/profile.ts). */
const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/me', async (request) => {
    const profile = await profiles.findOwn(scopeOf(request.user));
    if (!profile) throw new NotFoundError('User not found');
    return profile;
  });

  fastify.patch<{ Body: { name?: string; password?: string } }>('/me', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
        },
        // Only name/password are self-editable. Unknown keys (role, org_id, email, ...) must be
        // rejected: the app runs Ajv with removeAdditional: false, so they are not stripped.
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, password } = request.body;
    const user = await profiles.updateOwn(scopeOf(request.user), {
      name,
      passwordHash: password === undefined ? undefined : await hashPassword(password),
    });
    if (!user) throw new NotFoundError('User not found');

    if (password !== undefined) {
      // A new password ended every session; this one is re-issued with the new token version.
      issueSession(fastify, reply, { user_id: user.id, org_id: user.org_id, role: user.role, tv: user.token_version });
      request.log.info({ event: 'password_changed' }, 'Password changed; other sessions revoked');
      await auditBestEffort(originOf(request), {
        orgId: user.org_id, actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id,
      }, request.log);
    }

    return { id: user.id, name: user.name, email: user.email, role: user.role };
  });
};

export default profileRoutes;
