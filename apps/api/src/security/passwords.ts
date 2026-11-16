import bcrypt from 'bcrypt';

/** bcrypt work factor for stored passwords. */
export const BCRYPT_COST = 12;

/**
 * At most this many bcrypt operations run at once; the rest wait their turn.
 *
 * bcrypt runs on Node's libuv thread pool, the same few threads that resolve hostnames, and so open
 * new database and Redis connections. In the Phase 9 load test, 2 logins/s at cost 12 kept every pool
 * thread busy: new database connections waited behind bcrypt and timed out, and 46% of ALL requests
 * failed. Capping bcrypt (plus UV_THREADPOOL_SIZE=16 in the image) keeps logins from taking the rest
 * of the API down with them; a login burst just makes logins slower. See docs/load-testing.md.
 */
export const BCRYPT_CONCURRENCY = Math.max(1, Number(process.env.BCRYPT_CONCURRENCY) || 2);

let running = 0;
const waiting: Array<() => void> = [];

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= BCRYPT_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else running -= 1;
  }
}

export const hashPassword = (password: string) => limited(() => bcrypt.hash(password, BCRYPT_COST));

/**
 * A valid bcrypt hash of a random value, compared against when there is no stored hash (an unknown
 * email, or a removed member), so "no such user" takes as long as "wrong password".
 */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash(`no-such-user-${Math.random()}`, BCRYPT_COST));

/** Whether `password` matches `hash`. With no usable hash it still spends the same time, then says no. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  // '!...' marks an account that cannot sign in (a removed member, see migration 013).
  const usable = typeof hash === 'string' && hash.length > 0 && !hash.startsWith('!');
  const target = usable ? hash : await getDummyHash();
  const match = await limited(() => bcrypt.compare(password, target));
  return usable && match;
}

/** For tests: how many operations are running and queued. */
export const bcryptQueue = () => ({ running, waiting: waiting.length });
