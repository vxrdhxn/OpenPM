import { defineConfig } from 'vitest/config';

// Unit tests for framework-free logic (src/lib). Browser flows are covered by Playwright (test:e2e).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
