import { expect, test, type Page } from '@playwright/test';
import { API, createProject, createTask } from './helpers';

/**
 * What people see when things go wrong: the API answers with an error, the network fails, or the
 * browser goes offline. Failures are injected with page.route, so the real API stays healthy and only
 * the request under test fails.
 */

const fail = (page: Page, pattern: RegExp, status = 500, body = { error: 'Something went wrong on the server' }) =>
  page.route(pattern, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));

/** Whether the server still has the task (there is no single-task GET: look in the board's columns). */
async function taskExists(page: Page, projectId: string, taskId: string) {
  const board = await (await page.request.get(`${API}/projects/${projectId}/tasks`)).json();
  return ['todo', 'in_progress', 'in_review', 'done'].some((c) => (board[c] ?? []).some((t: { id: string }) => t.id === taskId));
}

/** Waits until the board's live connection is up (connecting reloads the tasks). */
async function openBoard(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('when the API fails', () => {
  test('the projects list says so, and "Try again" recovers', async ({ page }) => {
    await fail(page, /\/api\/projects\?/);
    await page.goto('/projects');
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toContainText('Something went wrong on the server');

    await page.unroute(/\/api\/projects\?/);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Filter by status' })).toBeVisible();
  });

  test('a dashboard section that fails does not blank the others', async ({ page }) => {
    await fail(page, /\/api\/activity\?/);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    // The failed section shows the error; the headline numbers still load.
    await expect(page.getByRole('main').getByRole('alert').filter({ hasText: 'Something went wrong on the server' })).toBeVisible();
    await expect(page.getByText('My open tasks')).toBeVisible();
  });

  test('a network failure (no answer at all) is reported, not left spinning', async ({ page }) => {
    await page.route(/\/api\/projects\?/, (route) => route.abort('failed'));
    await page.goto('/projects');
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert').getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a board that cannot load its tasks says so', async ({ page }) => {
    const projectId = await createProject(page);
    await fail(page, new RegExp(`/api/projects/${projectId}/tasks`));
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on the server' })).toBeVisible();
  });

  test('a move the server refuses is put back, with a message', async ({ page }) => {
    const projectId = await createProject(page);
    await createTask(page, projectId, 'Refused move');
    await openBoard(page, projectId);

    await page.route(/\/api\/projects\/[^/]+\/tasks\/[^/?]+$/, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'You cannot change this task' }) })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Move task: Refused move' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');

    await expect(page.getByText('You cannot change this task')).toBeVisible();
    await expect(page.getByRole('region', { name: 'To Do' }).getByRole('button', { name: 'Open task: Refused move' })).toBeVisible();
  });

  test('a failed save keeps the edits and says why', async ({ page }) => {
    const projectId = await createProject(page);
    await createTask(page, projectId, 'Keep my edits');
    await openBoard(page, projectId);
    await page.getByRole('button', { name: 'Open task: Keep my edits' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill('Keep my edits, please');

    await fail(page, /\/api\/projects\/[^/]+\/tasks\/[^/?]+$/, 500);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Something went wrong on the server')).toBeVisible();
    await expect(dialog.getByLabel('Title')).toHaveValue('Keep my edits, please');
  });

  test('going offline shows a banner, and coming back removes it', async ({ page, context }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('You are offline')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('You are offline')).toHaveCount(0);
  });
});

test.describe('undo after delete', () => {
  const deleteFromDialog = async (page: Page, title: string) => {
    await page.getByRole('button', { name: `Open task: ${title}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click();
  };

  test('Undo brings the task back, and it is never deleted on the server', async ({ page }) => {
    const projectId = await createProject(page);
    const taskId = await createTask(page, projectId, 'Undo me');
    await openBoard(page, projectId);

    let deletes = 0;
    page.on('request', (r) => r.method() === 'DELETE' && r.url().includes(taskId) && deletes++);
    await deleteFromDialog(page, 'Undo me');
    await expect(page.getByRole('button', { name: 'Open task: Undo me' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'To Do' }).getByRole('button', { name: 'Open task: Undo me' })).toBeVisible();
    // Past the grace period: still nothing sent, and the server still has the task.
    await page.waitForTimeout(7500);
    expect(deletes).toBe(0);
    expect(await taskExists(page, projectId, taskId)).toBe(true);
  });

  test('without Undo, the delete is sent after the grace period', async ({ page }) => {
    const projectId = await createProject(page);
    const taskId = await createTask(page, projectId, 'Delete me');
    await openBoard(page, projectId);

    const sent = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().includes(taskId), { timeout: 15_000 });
    await deleteFromDialog(page, 'Delete me');
    await expect(page.getByRole('button', { name: 'Open task: Delete me' })).toHaveCount(0);
    await sent;
    await expect.poll(() => taskExists(page, projectId, taskId)).toBe(false);
  });

  test('leaving the page during the grace period still deletes it', async ({ page }) => {
    const projectId = await createProject(page);
    const taskId = await createTask(page, projectId, 'Leave and delete');
    await openBoard(page, projectId);

    await deleteFromDialog(page, 'Leave and delete');
    await expect(page.getByRole('button', { name: 'Open task: Leave and delete' })).toHaveCount(0);
    // A full navigation away (pagehide) sends the pending delete at once.
    await page.goto('about:blank');
    await expect.poll(() => taskExists(page, projectId, taskId), { timeout: 10_000 }).toBe(false);
  });
});
