import pino from 'pino';

/**
 * Structured (JSON) logging for the worker, matching the API's format so one query works across
 * both: `level` is a label, `time` is ISO-8601, `service` names the process, and jobs log with the
 * `request_id` of the HTTP request that enqueued them.
 */

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** An unrecognized LOG_LEVEL must not stop the worker from starting (pino throws on unknown levels). */
export function resolveLevel(value: string | undefined): (typeof LEVELS)[number] {
  return (LEVELS as readonly string[]).includes(value ?? '') ? (value as (typeof LEVELS)[number]) : 'info';
}

/** Paths whose values are replaced by "[Redacted]" before anything is written. */
export const REDACT_PATHS = [
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.secret',
  '*.apiKey',
  'password',
  'password_hash',
  'token',
  'authorization',
  'apiKey',
];

export const loggerOptions: pino.LoggerOptions = {
  level: resolveLevel(process.env.LOG_LEVEL),
  base: { service: 'openpm-worker' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
};

export const logger = pino(loggerOptions);

export type Logger = pino.Logger;

/** The part after the @, so logs show where mail went without storing someone's address. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : 'invalid';
}
