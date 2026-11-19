import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { config } from '../config';
import type { Logger } from './logger';

/**
 * Publishing to the API's realtime channels (org:<id>:updates), which every API pod relays to the
 * organization's sockets. A connection of its own: the BullMQ worker's connection runs blocking
 * commands. Opened on first use.
 */
let client: IORedis | null = null;

function connection(): IORedis {
  if (!client) {
    client = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    client.on('error', () => undefined); // reported per publish below
  }
  return client;
}

/** Best effort, like the API's publishes: a lost live event only delays what clients fetch anyway. */
export async function publish(channel: string, message: unknown, log: Pick<Logger, 'warn'>): Promise<void> {
  try {
    // The same envelope as the API's events (docs/realtime.md).
    await connection().publish(channel, JSON.stringify({ ...(message as object), event_id: randomUUID(), published_at: new Date().toISOString() }));
  } catch (err) {
    log.warn({ err, channel }, 'Could not publish a live event');
  }
}

export async function closePublisher(): Promise<void> {
  if (client) await client.quit().catch(() => undefined);
  client = null;
}
