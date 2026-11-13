import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * Methods the browser app is allowed to use cross-origin. Spelled out on purpose: @fastify/cors 10+
 * defaults to only GET,HEAD,POST, which makes the preflight reject every PATCH/PUT/DELETE (moving or
 * editing a task, deleting an attachment, ...) while the API itself still works fine from curl.
 */
export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function corsOptions(origin: FastifyCorsOptions['origin']): FastifyCorsOptions {
  return { origin, credentials: true, methods: CORS_METHODS };
}
