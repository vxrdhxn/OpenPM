import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running API (default http://localhost:3000; `docker compose up` starts it)
 * and the frontend dev server (started here if it is not running). See docs/frontend-testing.md.
 *
 * `setup` registers one throwaway workspace and saves its session; the other projects reuse it, so a
 * run stays well inside the API's registration rate limit (10 a minute).
 */
export default defineConfig({
  testDir: './tests',
  // The dev server compiles each page on its first visit, which can take several seconds.
  timeout: 90_000,
  // Same reason: a navigation can wait on an on-demand compile (default 5 s is too tight).
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI, `github` turns each failure into an annotation on the check run (visible on the PR).
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    // Entrance animations fade content in from transparent. axe would measure contrast mid-fade, and
    // clicks would wait for moving elements, so the tests run with reduced motion (which the app
    // honours by turning animations off). Motion itself is decoration, not behaviour.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/admin.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      // Phone layout on Chromium (an iPhone profile would need WebKit installed).
      name: 'phone',
      use: { ...devices['Pixel 7'], storageState: 'tests/.auth/admin.json' },
      dependencies: ['setup'],
      testMatch: /(responsive|a11y)\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
      },
});
