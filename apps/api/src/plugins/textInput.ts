import fp from 'fastify-plugin';

/** True if any string in the value (at any depth) contains a NUL character. */
export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 32 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  for (const [key, v] of Object.entries(value)) {
    if (key.includes('\u0000') || containsNul(v, depth + 1)) return true;
  }
  return false;
}

/**
 * Postgres text cannot hold a NUL character (U+0000): an insert or a comparison with one fails with
 * SQLSTATE 22021, which used to reach clients as a 500. Nothing legitimate sends it, so any request
 * with one in its body, query string or path is a 400 before a handler runs.
 */
export default fp(async function textInput(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    if (containsNul(request.body) || containsNul(request.query) || containsNul(request.params)) {
      return reply.code(400).send({ error: 'Invalid request: text may not contain NUL characters' });
    }
  });
});
