import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { cacheBypassedTotal, redisErrorsTotal } from '../metrics';
import { RealtimeHub, Handler } from '../realtime/hub';

/**
 * The cache is an optimization: when Redis is down, requests carry on without it (reads go to the
 * database) instead of failing or hanging. Hence, for this client only:
 * - enableOfflineQueue: false. While disconnected, commands fail at once. With the default they wait
 *   in a queue until Redis comes back, and the request hangs with them.
 * - autoResendUnfulfilledCommands: false. A command cut off by a dropped connection is not replayed
 *   after reconnecting (a replayed SET could put back data that was invalidated in the meantime).
 * The pub/sub subscriber and the BullMQ queue use their own connections and keep the defaults.
 */
const client = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
});

client.on('error', (err) => {
  redisErrorsTotal.inc({ client: 'main' });
  logger.error({ err }, 'Redis connection error');
});

/** How long a cache command may take before the request gives up on it and carries on without. */
export const CACHE_COMMAND_TIMEOUT_MS = 250;

/** Upper bound on invalidations remembered during an outage (beyond it, entries expire by TTL). */
const MAX_PENDING_DELETES = 10_000;

/**
 * Invalidations that failed while Redis was unavailable, retried as soon as it is back. Without
 * this, data cached before the outage would be served stale after it until its TTL ran out.
 */
const pendingDeletes = new Set<string>();

client.on('ready', () => {
  if (pendingDeletes.size === 0) return;
  const keys = [...pendingDeletes];
  pendingDeletes.clear();
  client.del(...keys).then(
    () => logger.info({ keys: keys.length }, 'Applied cache invalidations missed during a Redis outage'),
    (err) => {
      for (const key of keys) rememberDelete(key);
      logger.warn({ err, keys: keys.length }, 'Could not apply missed cache invalidations; will retry');
    }
  );
});

function rememberDelete(key: string) {
  if (pendingDeletes.size < MAX_PENDING_DELETES) pendingDeletes.add(key);
}

const FAILED = Symbol('cache operation failed');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis command timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run one cache command, or skip it if Redis is not available. Never throws: a failure is counted
 * (cache_bypassed_total) and reported as FAILED so the caller falls back. While Redis is down the
 * connection errors are already logged, so a skipped command only adds a metric, not a log line.
 */
async function attempt<T>(operation: string, run: () => Promise<T>): Promise<T | typeof FAILED> {
  if (client.status !== 'ready') {
    cacheBypassedTotal.inc({ operation, reason: 'unavailable' });
    return FAILED;
  }
  try {
    return await withTimeout(run(), CACHE_COMMAND_TIMEOUT_MS);
  } catch (err) {
    cacheBypassedTotal.inc({ operation, reason: 'error' });
    logger.warn({ err, operation }, 'Cache command failed; continuing without the cache');
    return FAILED;
  }
}

/** Stamp an event with a unique id and the time it was published (plain objects only). */
export function withEnvelope(message: unknown): unknown {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return message;
  return { ...(message as Record<string, unknown>), event_id: randomUUID(), published_at: new Date().toISOString() };
}

export const cache = {
  /** The cached value, or null on a miss, an unreadable entry, or when Redis is unavailable. */
  async get<T>(key: string): Promise<T | null> {
    const data = await attempt('get', () => client.get(key));
    if (data === FAILED || !data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  },

  /** Best effort: if Redis is unavailable the value is simply not cached. */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const data = JSON.stringify(value);
    await attempt('set', () => (ttlSeconds ? client.set(key, data, 'EX', ttlSeconds) : client.set(key, data)));
  },

  /**
   * Invalidate a key. Called after a database write has committed, so it must not fail the request;
   * if Redis is unavailable, the key is remembered and deleted once Redis is back.
   */
  async del(key: string): Promise<void> {
    const result = await attempt('del', () => client.del(key));
    if (result === FAILED) rememberDelete(key);
  },

  /**
   * Best effort: real-time events are not delivered while Redis is down (clients refetch on reconnect).
   * Every event gets an `event_id` and `published_at` (docs/realtime.md), so a client can drop one it
   * has already applied.
   */
  async publish(channel: string, message: any): Promise<void> {
    await attempt('publish', () => client.publish(channel, JSON.stringify(withEnvelope(message))));
  },

  /** Whether Redis answers right now (for the health check). */
  async ping(): Promise<boolean> {
    if (client.status !== 'ready') return false;
    try {
      await withTimeout(client.ping(), CACHE_COMMAND_TIMEOUT_MS * 2);
      return true;
    } catch {
      return false;
    }
  },

  /** Invalidations waiting for Redis to come back (exposed for tests). */
  pendingInvalidations(): number {
    return pendingDeletes.size;
  },

  /**
   * Subscribe to a channel. All local subscriptions share ONE dedicated Redis subscriber
   * connection per process (see RealtimeHub), instead of one connection per caller.
   * Returns an idempotent unsubscribe function.
   */
  async subscribe(channel: string, handler: Handler): Promise<() => void> {
    return getHub().subscribe(channel, handler);
  }
};

// A connection in subscriber mode can't run normal commands, so it must be separate from `client`.
// Created lazily so importing this module doesn't open a second connection until it's needed.
let hub: RealtimeHub | null = null;
let hubSubscriber: Redis | null = null;

function getHub(): RealtimeHub {
  if (!hub) {
    const subscriber = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on('error', (err) => {
      redisErrorsTotal.inc({ client: 'subscriber' });
      logger.error({ err }, 'Redis subscriber connection error');
    });
    // ioredis re-issues SUBSCRIBE for active channels after a reconnect (autoResubscribe, default on).
    hubSubscriber = subscriber;
    hub = new RealtimeHub(subscriber);
  }
  return hub;
}

/** Close the cache/publish client and, if it was opened, the pub/sub subscriber (on shutdown). */
export async function closeRedis(): Promise<void> {
  const clients = hubSubscriber ? [client, hubSubscriber] : [client];
  // QUIT lets pending commands finish; fall back to a hard disconnect if Redis is unreachable.
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
}
