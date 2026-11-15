import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: everything under src/ except the integration suite (*.int.test.ts), which needs a real
// Postgres and runs with `npm run test:integration` (vitest.integration.config.mts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'dist/**', 'src/**/*.int.test.ts'],
  },
});
