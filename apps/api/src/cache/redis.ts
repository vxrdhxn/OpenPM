import { Redis } from 'ioredis';
import { config } from '../config';

const client = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

client.on('error', (err) => {
  console.error('Redis connection error:', err);
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

  // Subscriber logic should use a separate connection to avoid blocking the main client
  async subscribe(channel: string, handler: (message: any) => void): Promise<() => void> {
    const subClient = new Redis(config.REDIS_URL);
    
    await subClient.subscribe(channel);
    
    subClient.on('message', (ch, msg) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(msg));
        } catch (e) {
          console.error('Error parsing Redis message', e);
        }
      }
    });

    return () => {
      subClient.unsubscribe(channel);
      subClient.quit();
    };
  }
};
