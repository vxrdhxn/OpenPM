import { expect, test } from '@playwright/test';
import { createProject, createTask, unique } from './helpers';

test.describe('core journey', () => {
  test('sign up, create a project from the welcome card, and work a task through its life', async ({ browser }) => {
    // A fresh browser without the shared session: this is the new-user path.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const id = unique();

    await page.goto('/register');
    await page.getByLabel('Company Name').fill('Journey Co');
    await page.getByLabel('Workspace Slug').fill(`journey-${id}`);
    await page.getByLabel('Full Name').fill('Jo Journey');
    await page.getByLabel('Email Address').fill(`journey-${id}@example.com`);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create Workspace' }).click();

    // First run: the welcome card leads to the project dialog.
    await expect(page.getByRole('heading', { name: 'Welcome to OpenPM' })).toBeVisible();
    await page.getByRole('link', { name: 'Create your first project' }).click();
    const projectDialog = page.getByRole('dialog', { name: 'New project' });
    await expect(projectDialog.getByLabel('Name')).toBeFocused();
    await projectDialog.getByLabel('Name').fill('Launch');
    await projectDialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: 'Launch', level: 1 })).toBeVisible();

    // Add a task with every field.
    await page.getByRole('button', { name: 'Add task' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add task' });
    await addDialog.getByLabel('Title').fill('Write the announcement');
    await addDialog.getByLabel('Priority').selectOption('high');
    await addDialog.getByLabel('Assignee').selectOption({ label: 'Jo Journey' });
    await addDialog.getByLabel('Due date').fill('2030-01-15');
    await addDialog.getByLabel('Description').fill('Blog post and social copy.');
    await addDialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Task created' })).toBeVisible();

    await page.getByRole('region', { name: 'To Do' }).getByRole('button', { name: 'Open task: Write the announcement' }).click();

    // Edit: the dialog shows what was saved, and a status change moves the card.
    const taskDialog = page.getByRole('dialog', { name: 'Write the announcement' });
    await expect(taskDialog.getByLabel('Priority')).toHaveValue('high');
    await expect(taskDialog.getByLabel('Due date')).toHaveValue('2030-01-15');
    await expect(taskDialog.getByLabel('Description')).toHaveValue('Blog post and social copy.');
    await taskDialog.getByLabel('Status').selectOption('in_progress');
    await taskDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Task saved' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'In Progress' }).getByRole('button', { name: 'Open task: Write the announcement' })
    ).toBeVisible();

    // Delete asks first, with Cancel focused; Cancel keeps the task.
    await taskDialog.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(taskDialog).toBeVisible();
    await taskDialog.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Task deleted' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open task: Write the announcement' })).toHaveCount(0);

    await context.close();
  });

  test('unsaved task edits are not lost by accident', async ({ page }) => {
    const projectId = await createProject(page);
    await createTask(page, projectId, 'Keep me');
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('button', { name: 'Open task: Keep me' }).click();
    const dialog = page.getByRole('dialog', { name: 'Keep me' });
    await dialog.getByLabel('Title').fill('Keep me (edited)');
    await page.keyboard.press('Escape');
    // Escape asks before throwing the edit away.
    await expect(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.getByLabel('Title')).toHaveValue('Keep me (edited)');
  });

  test('a task can be moved with the keyboard', async ({ page }) => {
    const projectId = await createProject(page);
    await createTask(page, projectId, 'Move me');
    await page.goto(`/projects/${projectId}`);
    // Drag handle: Space lifts, an arrow key moves to the next column, Space drops.
    await page.getByRole('button', { name: 'Move task: Move me' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(page.getByRole('region', { name: 'In Progress' }).getByRole('button', { name: 'Open task: Move me' })).toBeVisible();
    // And it was saved, not only moved on screen.
    await page.reload();
    await expect(page.getByRole('region', { name: 'In Progress' }).getByRole('button', { name: 'Open task: Move me' })).toBeVisible();
  });

  test('an unknown project and an unknown page say so', async ({ page }) => {
    await page.goto('/projects/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
