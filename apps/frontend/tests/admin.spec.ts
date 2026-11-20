import { expect, test } from '@playwright/test';
import { API, unique } from './helpers';

// Signed out: each test signs in through one of the two doors itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('admin and member sign-in', () => {
  const password = 'password123';
  let email = '';

  test.beforeEach(async ({ page, context }) => {
    // A fresh workspace; its creator is the owner. Registering signs in, so sign out again.
    const id = unique();
    email = `owner-${id}@example.com`;
    const res = await page.request.post(`${API}/auth/register`, {
      data: { org_name: 'Door Test', org_slug: `doors-${id}`, email, password, name: 'Olive Owner' },
    });
    expect(res.status(), await res.text()).toBe(201);
    await context.clearCookies();
  });

  test('/admin/login is the admin door, and an owner lands in the admin area', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page).toHaveURL(/\/login\?as=admin$/);
    await expect(page.getByRole('heading', { name: 'Admin sign-in', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sign in as' }).getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');

    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in as admin' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByText('Olive Owner').first()).toBeVisible();
    // Owners see the admin area in the sidebar too.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' })).toBeVisible();
  });

  test('the member door takes the same account to the dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('navigation', { name: 'Sign in as' }).getByRole('link', { name: 'Member' })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('switching doors keeps you on the sign-in page', async ({ page }) => {
    await page.goto('/login');
    const doors = page.getByRole('navigation', { name: 'Sign in as' });
    await doors.getByRole('link', { name: 'Admin' }).click();
    await expect(page).toHaveURL(/\/login\?as=admin$/);
    await expect(page.getByRole('button', { name: 'Sign in as admin' })).toBeVisible();
    await doors.getByRole('link', { name: 'Member' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible();
  });

  test('a member at the admin door is told so, and pointed to the member sign-in', async ({ page }) => {
    // The API refuses members with a 403 (covered in the API's tests); here, how the page says it.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'This account is not a workspace admin. Sign in as a member instead.' }) }),
    );
    await page.goto('/login?as=admin');
    await page.getByLabel('Email Address').fill('member@example.com');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in as admin' }).click();

    // Not just getByRole('alert'): Next.js keeps its own (empty) route announcer on the page.
    const alert = page.getByRole('alert').filter({ hasText: 'not a workspace admin' });
    await expect(alert).toContainText('not a workspace admin');
    await alert.getByRole('link', { name: 'Go to the member sign-in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
