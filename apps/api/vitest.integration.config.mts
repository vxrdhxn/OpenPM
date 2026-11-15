import { defineConfig } from 'vitest/config';

// Integration tests: the real app (routes, SQL, migrations) against a real Postgres. Redis and the job
// queue are replaced by in-memory fakes (src/test/integration/setup.ts).
//
// Needs a Postgres the tests may create databases on, given as TEST_DATABASE_URL (default: the Docker
// Compose one, postgresql://openpm:openpm@localhost:5432/postgres). Each run creates and drops its own
// database, so it never touches application data.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/test/integration/globalSetup.ts'],
    setupFiles: ['./src/test/integration/setup.ts'],
    // bcrypt (cost 12) and real queries are slower than mocked unit tests.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
