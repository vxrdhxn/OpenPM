import { CachedJson } from '../../cache/cachedJson';

/**
 * In-memory stand-ins for Redis (cache + pub/sub) and the BullMQ queue, so the integration suite needs
 * only Postgres. Tests read `published` and `jobs` to see what the API emitted.
 */

export const published: Array<{ channel: string; message: unknown }> = [];
export const jobs: Array<{ name: string; data: Record<string, any>; opts?: Record<string, unknown> }> = [];

const store = new Map<string, unknown>();

/**
 * Set to simulate a Redis outage. The fake then behaves as cache/redis.ts promises to when Redis is
 * unavailable (tested there): reads miss, writes are dropped, nothing throws, and ping is false.
 */
export const redisOutage = { active: false };

export const fakeCache = {
  async getRaw(key: string) {
    if (redisOutage.active || !store.has(key)) return null;
    return new CachedJson(JSON.stringify(store.get(key)));
  },
  async get(key: string) {
    if (redisOutage.active) return null;
    return store.has(key) ? structuredClone(store.get(key)) : null;
  },
  async set(key: string, value: unknown, _ttlSeconds?: number) {
    if (redisOutage.active) return;
    store.set(key, structuredClone(value));
  },
  async del(key: string) {
    if (redisOutage.active) return;
    store.delete(key);
  },
  async publish(channel: string, message: unknown) {
    if (redisOutage.active) return;
    published.push({ channel, message });
  },
  async ping() {
    return !redisOutage.active;
  },
  async subscribe() {
    return () => {};
  },
};

export const fakeQueue = {
  async add(name: string, data: Record<string, any>, opts?: Record<string, unknown>) {
    jobs.push({ name, data, opts });
    return { id: String(jobs.length), name, data };
  },
};

/** Wait until a job matching `match` has been enqueued (some routes enqueue after replying). */
export async function waitForJob(match: (job: (typeof jobs)[number]) => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = jobs.find(match);
    if (job) return job;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a job');
    await new Promise((r) => setTimeout(r, 20));
  }
}
