import { expect, test, type Page } from '@playwright/test';
import { createProject, createTask } from './helpers';

/** The page itself never scrolls sideways (the board scrolls inside its own container). */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('phone layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone project only');

  test('navigation is a menu, and it opens, navigates and closes', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    // The sidebar is hidden; a menu button replaces it.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(menu).toBeHidden();

    // Escape closes it too, and focus returns to the menu button.
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('main pages fit the screen', async ({ page }) => {
    for (const path of ['/dashboard', '/projects', '/notifications', '/settings/profile', '/settings/organization']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoPageOverflow(page);
    }
  });

  test('the board and task dialog work on a phone', async ({ page }) => {
    const projectId = await createProject(page, 'Phone board');
    await createTask(page, projectId, 'Tap me');
    await page.goto(`/projects/${projectId}`);
    await expectNoPageOverflow(page);
    await page.getByRole('button', { name: 'Open task: Tap me' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tap me' });
    await dialog.getByLabel('Status').selectOption('done');
    // The footer is sticky, so Save is reachable without scrolling past comments.
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeInViewport();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Task saved' })).toBeVisible();
  });
});
