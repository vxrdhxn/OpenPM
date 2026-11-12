import fp from 'fastify-plugin';
import { REQUEST_ID_HEADER } from '../logger';

/**
 * Return the request id to the caller (`X-Request-Id`), so a user or another service can quote it
 * and it can be matched to the log lines of that request. The id itself is chosen by genReqId
 * (logger.ts): a valid upstream id is kept, anything else is replaced by a fresh UUID.
 */
export default fp(async function (fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
});
