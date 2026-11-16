import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { overloadRejectionsTotal } from '../metrics';

/**
 * The database pool is exhausted: every connection is busy and none freed up within
 * connectionTimeoutMillis (pg-pool's message). That is overload, not a bug, so it is answered as
 * 503 + Retry-After (clients and load balancers retry or back off) and counted, not logged as an
 * unhandled error per request. See docs/load-testing.md.
 */
export const isPoolExhausted = (err: { message?: string }) =>
  err?.message === 'timeout exceeded when trying to connect';

/** Postgres error classes that mean "the database is not available right now", not a bad query. */
const UNAVAILABLE_SQLSTATES = new Set(['57P01', '57P02', '57P03']); // admin/crash shutdown, cannot connect now
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH']);

/**
 * The database cannot be reached (down, restarting, failing over). Also a 503: the request may well
 * succeed in a moment, and it is not a bug in this request.
 */
export function isDatabaseUnavailable(err: { message?: string; code?: string }): boolean {
  const code = String(err?.code ?? '');
  const message = String(err?.message ?? '');
  return (
    UNAVAILABLE_SQLSTATES.has(code) ||
    code.startsWith('08') || // connection_exception class
    NETWORK_CODES.has(code) ||
    message.startsWith('Connection terminated') ||
    message.startsWith('connect ECONNREFUSED')
  );
}

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

    if (isPoolExhausted(err)) {
      overloadRejectionsTotal.inc({ reason: 'db_pool' });
      request.log.warn({ event: 'overloaded', reason: 'db_pool' }, 'Database pool exhausted; answered 503');
      return reply.code(503).header('Retry-After', '1').send({ error: 'The server is busy. Please try again.' });
    }

    if (isDatabaseUnavailable(err)) {
      overloadRejectionsTotal.inc({ reason: 'db_unavailable' });
      request.log.warn({ event: 'unavailable', reason: 'db_unavailable', err: { message: err.message, code: err.code } }, 'Database unavailable; answered 503');
      return reply.code(503).header('Retry-After', '5').send({ error: 'The service is temporarily unavailable. Please try again shortly.' });
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.code(status).send({ error: status === 503 ? 'Service unavailable' : 'Internal server error' });
  });

  fastify.setNotFoundHandler(function (_request, reply) {
    return reply.code(404).send({ error: 'Not found' });
  });
});
