import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API, createProject, createTask } from './helpers';

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A and AA rules) on every main screen, in the
 * desktop and phone projects. Automated rules catch roughly a third of real problems; the manual
 * keyboard and screen-reader review is in docs/accessibility.md.
 */
async function expectNoViolations(page: Page) {
  // Let the page's requests finish so the scan sees loaded content, not skeletons.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test.describe('accessibility', () => {
  test('signed-out pages', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    for (const path of ['/', '/login', '/login?as=admin', '/register', '/forgot-password', '/verify-signup']) {
      await page.goto(path);
      await expectNoViolations(page);
    }
    await context.close();
  });

  test('dashboard, projects, notifications and settings', async ({ page }) => {
    // Scan lists with content, not only their empty states (a project card once failed contrast).
    const projectId = await createProject(page, 'A11y list');
    await createTask(page, projectId, 'Listed task', { priority: 'high' });
    for (const path of ['/dashboard', '/admin', '/projects', '/notifications', '/settings/profile', '/settings/notifications', '/settings/organization']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoViolations(page);
    }
  });

  test('board, task dialog and confirmation', async ({ page }) => {
    const projectId = await createProject(page, 'A11y board');
    await createTask(page, projectId, 'Check contrast', { priority: 'urgent', description: 'Details' });
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('button', { name: 'Open task: Check contrast' })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Open task: Check contrast' }).click();
    await expect(page.getByRole('dialog', { name: 'Check contrast' })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoViolations(page);
  });

  test('private project board and its people', async ({ page }) => {
    const res = await page.request.post(`${API}/projects`, { data: { name: 'A11y private', visibility: 'private' } });
    expect(res.status()).toBe(201);
    await page.goto(`/projects/${(await res.json()).id}`);
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'People' }).click();
    await expect(page.getByRole('dialog', { name: 'People in A11y private' })).toBeVisible();
    await expectNoViolations(page);
  });
});
