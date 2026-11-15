import { vi } from 'vitest';

// Applied to every integration test file: Redis and the job queue become in-memory fakes. Postgres,
// the routes, validation, auth and SQL are all real.
vi.mock('../../cache/redis', async () => {
  const { fakeCache } = await import('./fakes.js');
  return { cache: fakeCache };
});
vi.mock('../../queue', async () => {
  const { fakeQueue } = await import('./fakes.js');
  return { getJobQueue: () => fakeQueue };
});
