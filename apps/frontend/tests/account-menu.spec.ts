import { expect, test, type Browser, type Page } from '@playwright/test';
import { API, unique } from './helpers';

/**
 * The account menu (components/AccountMenu.tsx). Each test signs up its own workspace: signing out
 * ends every session of that user, which would sign out the shared session the other specs use.
 */
async function signedIn(browser: Browser, viewport?: { width: number; height: number }): Promise<{ page: Page; name: string; email: string }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  const id = unique();
  const name = 'Menu Person';
  const email = `menu-${id}@example.com`;
  const res = await page.request.post(`${API}/auth/register`, {
    data: { org_name: 'Menu Co', org_slug: `menu-${id}`, email, password: 'password123', name },
  });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto('/dashboard');
  return { page, name, email };
}

test.describe('account menu', () => {
  test('opens from the account button, shows who is signed in, and closes with Escape or a click outside', async ({ browser }) => {
    const { page, name, email } = await signedIn(browser);
    const button = page.getByRole('button', { name: `Account: ${name}` });
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toContainText(email);
    await expect(menu.getByRole('menuitem')).toHaveText(['Profile', 'Notification settings', 'Sign out']);
    await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
    await page.context().close();
  });

  test('works from the keyboard: arrows wrap, Home and End jump, Enter follows an item', async ({ browser }) => {
    const { page, name } = await signedIn(browser);
    const button = page.getByRole('button', { name: `Account: ${name}` });
    const item = (label: string) => page.getByRole('menuitem', { name: label });

    await button.focus();
    await page.keyboard.press('ArrowUp'); // opens on the last item
    await expect(item('Sign out')).toBeFocused();
    await page.keyboard.press('ArrowDown'); // wraps to the first
    await expect(item('Profile')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Notification settings')).toBeFocused();
    await page.keyboard.press('End');
    await expect(item('Sign out')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(item('Profile')).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/notifications$/);
    await expect(page.getByRole('menu', { name: 'Account' })).toBeHidden();
    await page.context().close();
  });

  test('signs out, and the session no longer works', async ({ browser }) => {
    const { page, name } = await signedIn(browser);
    await page.getByRole('button', { name: `Account: ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await page.context().close();
  });

  test('on a phone it sits in the menu drawer, and Escape closes only the account menu', async ({ browser }) => {
    const { page, name } = await signedIn(browser, { width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await drawer.getByRole('button', { name: `Account: ${name}` }).click();
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Account' })).toBeHidden();
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: `Account: ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(drawer).toBeHidden(); // navigating closes the drawer
    await page.context().close();
  });
});
