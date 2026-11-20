import { expect, test } from '@playwright/test';
import { unique } from './helpers';

/**
 * Private projects in the UI. Who sees what across users is tested against the API
 * (apps/api/src/test/integration/projectAccess.int.test.ts); a second workspace member cannot be
 * created here without the emailed invite link.
 */
test.describe('private projects', () => {
  test('create a private project, see who is in it, and open it to the workspace again', async ({ page }) => {
    const name = `Payroll ${unique()}`;

    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    const create = page.getByRole('dialog', { name: 'New project' });
    await create.getByLabel('Name').fill(name);
    await expect(create.getByLabel('Who can see it')).toHaveValue('workspace'); // the default
    await create.getByLabel('Who can see it').selectOption('private');
    await expect(create.getByText(/Only people added to it/)).toBeVisible();
    await create.getByRole('button', { name: 'Create project' }).click();

    // The board says it is private, and People lists the creator as added.
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'People' }).click();
    const people = page.getByRole('dialog', { name: `People in ${name}` });
    await expect(people.getByRole('region', { name: /Added \(1\)/ })).toContainText('E2E Owner');
    await people.getByRole('button', { name: 'Done' }).click();

    // So does its card on the projects page.
    await page.goto('/projects');
    // Scoped to the page: the sidebar's "Recent boards" links to it too.
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) })).toContainText('Private');

    // Back to the whole workspace.
    await page.getByRole('main').getByRole('link', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Edit project' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit project' });
    await edit.getByLabel('Who can see it').selectOption('workspace');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Project saved' })).toBeVisible();
    await expect(page.getByText('Private', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
  });

  test('making a shared project private asks first', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New project' }).click();
    const create = page.getByRole('dialog', { name: 'New project' });
    const name = `Shared ${unique()}`;
    await create.getByLabel('Name').fill(name);
    await create.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Edit project' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit project' });
    await edit.getByLabel('Who can see it').selectOption('private');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Make this project private?' });
    await expect(confirm).toContainText('Tasks assigned to anyone else are unassigned');
    await confirm.getByRole('button', { name: 'Make private' }).click();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
  });
});
