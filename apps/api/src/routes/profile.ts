import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { issueSession } from '../plugins/session';
import { originOf } from '../security/audit';
import * as profileService from '../services/profile';

/** /api/profile/me: the caller's own account (services/profile.ts). */
const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/me', async (request) => profileService.getProfile(scopeOf(request.user)));

  fastify.patch<{ Body: { name?: string; password?: string; current_password?: string } }>('/me', {
    // A wrong current password must not be guessable by retrying, like the sign-in form.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
          current_password: { type: 'string', maxLength: 1024 },
        },
        // A new password needs the current one.
        dependencies: { password: ['current_password'] },
        // Only name/password are self-editable. Unknown keys (role, org_id, email, ...) must be
        // rejected: the app runs Ajv with removeAdditional: false, so they are not stripped.
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, password, current_password: currentPassword } = request.body;
    const user = await profileService.updateProfile(scopeOf(request.user), { name, password, currentPassword }, originOf(request), request.log);

    if (password !== undefined) {
      // A new password ended every session; this one is re-issued with the new token version.
      issueSession(fastify, reply, { user_id: user.id, org_id: user.org_id, role: user.role, tv: user.token_version });
    }
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  });
};

export default profileRoutes;
