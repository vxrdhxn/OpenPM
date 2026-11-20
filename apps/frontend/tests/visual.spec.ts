import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression: each page is compared with a committed screenshot, so a change that moves,
 * recolours or breaks the layout is caught even when every functional test passes. Opt-in (the
 * `visual` project runs only with E2E_VISUAL=1; see playwright.config.ts for baselines per platform).
 *
 * Signed out, so no data (dates, names) changes between runs. Reduced motion (set for every test)
 * keeps animations still; 3D canvases are masked, because WebGL output differs between GPUs.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

const shot = async (page: Page, name: string) =>
  expect(page).toHaveScreenshot(name, {
    mask: [page.locator('canvas')],
    // Antialiasing differs slightly between runs; a real change moves far more than this.
    maxDiffPixelRatio: 0.01,
  });

const PAGES: [string, string][] = [
  ['/', 'home.png'],
  ['/login', 'login.png'],
  ['/login?as=admin', 'login-admin.png'],
  ['/register', 'register.png'],
  ['/forgot-password', 'forgot-password.png'],
];

for (const [path, name] of PAGES) {
  test(`looks the same: ${path}`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    await shot(page, name);
  });
}

test('looks the same: sign-in, dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('openpm-theme', 'dark'));
  await page.goto('/login');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, 'login-dark.png');
});
