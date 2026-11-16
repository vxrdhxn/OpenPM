import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';

/**
 * One error shape for every response the API sends: `{ "error": "<message>" }` (what route handlers
 * already return, and what the frontend reads). Without this, Fastify's own errors (validation,
 * unknown route, body too large, rate limit, ...) used a different shape, and an unhandled exception
 * returned its raw message, which can leak SQL, hostnames or file paths.
 *
 * - 4xx raised by Fastify or a plugin: the message is meant for the client, so it is passed through.
 * - Validation errors: 400 with Ajv's message, e.g. `Invalid request: body/email must match format "email"`.
 * - Everything else (5xx, or an error without a status): logged in full, answered with a generic message.
 *   The request id is in the `X-Request-Id` header, so a user report can be matched to the log line.
 */
export default fp(async function errorHandling(fastify) {
  fastify.setErrorHandler(function (err: FastifyError, request, reply) {
    if (err.validation) {
      request.log.info({ err: { message: err.message, context: err.validationContext } }, 'Request validation failed');
      return reply.code(400).send({ error: `Invalid request: ${err.message}` });
    }

    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;

    if (status < 500) {
      request.log.info({ err: { message: err.message, code: err.code }, statusCode: status }, 'Request rejected');
      return reply.code(status).send({ error: err.message || 'Bad request' });
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.code(status).send({ error: status === 503 ? 'Service unavailable' : 'Internal server error' });
  });

  fastify.setNotFoundHandler(function (_request, reply) {
    return reply.code(404).send({ error: 'Not found' });
  });
});
