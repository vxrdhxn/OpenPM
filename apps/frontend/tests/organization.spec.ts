import { expect, test, type Browser } from '@playwright/test';
import { unique } from './helpers';

/** A throwaway workspace in a fresh browser (deleting the shared one would break the other tests). */
async function newWorkspace(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const id = unique();
  const workspace = { slug: `doomed-${id}`, email: `doomed-${id}@example.com`, password: 'password123' };

  await page.goto('/register');
  await page.getByLabel('Company Name').fill('Doomed Co');
  await page.getByLabel('Workspace Slug').fill(workspace.slug);
  await page.getByLabel('Full Name').fill('Owen Owner');
  await page.getByLabel('Email Address').fill(workspace.email);
  await page.getByLabel('Password').fill(workspace.password);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to OpenPM' })).toBeVisible();
  return { context, page, ...workspace };
}

test.describe('workspace settings', () => {
  test('the owner renames the workspace, then deletes it with the slug and password', async ({ browser }) => {
    const { context, page, slug, email, password } = await newWorkspace(browser);

    await page.goto('/settings/organization');
    const workspace = page.getByRole('region', { name: 'Workspace' });
    await expect(workspace.getByText(slug)).toBeVisible();

    // Rename.
    await workspace.getByLabel('Name').fill('Renamed Co');
    await workspace.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Organization renamed' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Workspace' }).getByLabel('Name')).toHaveValue('Renamed Co');

    // The only owner cannot leave; the page says why.
    await expect(page.getByRole('button', { name: 'Leave' })).toBeDisabled();
    await expect(page.getByText(/To leave: transfer ownership/)).toBeVisible();

    // Delete: nothing happens until the slug matches and the password is given.
    await page.getByRole('button', { name: 'Delete workspace…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete Renamed Co?' });
    const confirm = dialog.getByRole('button', { name: 'Delete workspace' });
    await expect(dialog.getByLabel(/to confirm/)).toBeFocused();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill('not-the-slug');
    await dialog.getByLabel('Your password').fill(password);
    await expect(confirm).toBeDisabled();

    // A wrong password is refused and keeps the dialog open.
    await dialog.getByLabel(/to confirm/).fill(slug);
    await dialog.getByLabel('Your password').fill('wrong-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText('password is incorrect');

    await dialog.getByLabel('Your password').fill(password);
    await confirm.click();
    await expect(page).toHaveURL(/\/login\?deleted=1$/);
    await expect(page.getByRole('status').filter({ hasText: 'The workspace was deleted' })).toBeVisible();

    // The account went with it.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();

    await context.close();
  });
});
