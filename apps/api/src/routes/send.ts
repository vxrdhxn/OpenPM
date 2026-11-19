import type { FastifyReply } from 'fastify';
import { CachedJson } from '../cache/cachedJson';

/**
 * Answer with a service result that may come straight from the cache: stored JSON text is sent as
 * is (no parse, no re-serialization); anything else goes through Fastify's normal serialization.
 */
export function sendJson<T>(reply: FastifyReply, result: T | CachedJson): T | FastifyReply {
  if (result instanceof CachedJson) return reply.type('application/json; charset=utf-8').send(result.json);
  return result;
}
