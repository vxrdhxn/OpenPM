import { defineConfig } from 'vitest/config';

// Cross-package checks that don't belong to any single workspace (e.g. dashboards vs. metrics code).
// Run with `npm run test:repo`; each package runs its own tests via `npm test --workspaces`.
//
// Deliberately NOT named vitest.config.ts: workspaces would auto-discover a root config and then
// run only these tests instead of their own (and, with --passWithNoTests, still exit 0).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
