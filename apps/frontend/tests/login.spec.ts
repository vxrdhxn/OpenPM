import { test, expect } from '@playwright/test';

// Signed out: the shared session would send /login straight to the dashboard.
test.use({ storageState: { cookies: [], origins: [] } });

test('has title and login form', async ({ page }) => {
  await page.goto('/login');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/OpenPM/);

  // Expect the login form to be visible.
  await expect(page.locator('form')).toBeVisible();
  
  // Expect email and password inputs
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('pages cannot be framed by other sites and do not advertise the server', async ({ page }) => {
  const response = await page.goto('/login');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
});
