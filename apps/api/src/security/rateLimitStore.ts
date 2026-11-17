import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { redisErrorsTotal } from '../metrics';

/**
 * The Redis connection that holds rate-limit counters, so a limit applies across every API pod
 * rather than to each one (with 10 pods, a per-pod "10 sign-in attempts a minute" was 100).
 *
 * Like the cache, it must never make requests hang: while Redis is unreachable, commands fail at
 * once (no offline queue) and the limiter lets requests through (`skipOnError` in app.ts). An
 * outage disables rate limiting rather than the API.
 */
export function createRateLimitRedis(url = config.REDIS_URL): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 500,
  });
  client.on('error', (err) => {
    redisErrorsTotal.inc({ client: 'rate_limit' });
    logger.error({ err }, 'Redis rate-limit connection error');
  });
  return client;
}
