import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { redisErrorsTotal } from '../metrics';
import { RealtimeHub, Handler } from '../realtime/hub';

const client = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

client.on('error', (err) => {
  redisErrorsTotal.inc({ client: 'main' });
  logger.error({ err }, 'Redis connection error');
});

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const data = await client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  },

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const data = JSON.stringify(value);
    if (ttlSeconds) {
      await client.set(key, data, 'EX', ttlSeconds);
    } else {
      await client.set(key, data);
    }
  },

  async del(key: string): Promise<void> {
    await client.del(key);
  },

  async publish(channel: string, message: any): Promise<void> {
    await client.publish(channel, JSON.stringify(message));
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

function getHub(): RealtimeHub {
  if (!hub) {
    const subscriber = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on('error', (err) => {
      redisErrorsTotal.inc({ client: 'subscriber' });
      logger.error({ err }, 'Redis subscriber connection error');
    });
    // ioredis re-issues SUBSCRIBE for active channels after a reconnect (autoResubscribe, default on).
    hub = new RealtimeHub(subscriber);
  }
  return hub;
}
