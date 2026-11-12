import { randomUUID } from 'crypto';
import pino, { LoggerOptions } from 'pino';
import { config } from './config';

/**
 * Structured (JSON) logging, one line per event.
 *
 * - Fields are stable and machine-parseable: `level` is a label ("info"), `time` is ISO-8601,
 *   `service` identifies the process, and `request_id` ties together everything from one request
 *   (and the background jobs it enqueues).
 * - Anything that can carry a credential is redacted before it is written, so a stray
 *   `log.info({ req })` or `log.error({ err })` can't leak a token or password.
 */

/** Paths (pino-redact syntax) whose values are replaced by "[Redacted]". */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.secret',
  '*.secretAccessKey',
  'password',
  'password_hash',
  'token',
  'authorization',
  'cookie',
];

export const loggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  base: { service: 'openpm-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // "level":"info" rather than pino's numeric default, so log tools can filter by name.
    level: (label) => ({ level: label }),
  },
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
};

/** For code that runs outside a request (startup, Redis/Postgres connection errors, ...). */
export const logger = pino(loggerOptions);

// A client-supplied id is only trusted if it looks like an id: it ends up in every log line and in
// a response header, so newlines, spaces or huge values must never get through.
const VALID_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Honor an upstream `X-Request-Id` (e.g. set by an ingress or API gateway) so one id follows a
 * request across services; otherwise mint one.
 */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
