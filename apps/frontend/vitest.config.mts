import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for framework-free logic (src/lib). Browser flows are covered by Playwright (test:e2e).
export default defineConfig({
  // The API's wire vocabulary, shared with the frontend (tsconfig.json has the same alias).
  resolve: { alias: { '@openpm/wire': fileURLToPath(new URL('../api/src/wire/index.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
