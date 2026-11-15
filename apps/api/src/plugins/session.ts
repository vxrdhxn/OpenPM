import type { FastifyInstance, FastifyReply } from 'fastify';

export const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Sign a session JWT and set it as the httpOnly auth cookie. Returns the token, which the auth routes
 * also return in the body for non-browser clients.
 */
export function issueSession(
  fastify: FastifyInstance,
  reply: FastifyReply,
  payload: { user_id: string; org_id: string; role: string }
): string {
  const token = fastify.jwt.sign(payload, { expiresIn: SESSION_TTL_SECONDS });

  reply.setCookie('auth_token', token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL_SECONDS,
  });

  return token;
}
