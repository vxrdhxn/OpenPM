import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { API, unique } from './helpers';

/**
 * README screenshots (docs/screenshots/). Not a test: it fills a fresh workspace with demo data and
 * saves a picture of each main screen, in light and dark. Opt-in, like the visual project:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
 *   cd apps/frontend && E2E_SCREENSHOTS=1 E2E_BASE_URL=http://localhost:3001 npx playwright test --project=screenshots
 */

const OUT = '../../docs/screenshots';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function ok<T = { id: string }>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function seed(req: APIRequestContext) {
  const id = unique();
  // A clean address for the pictures; on a database that already has it, a numbered one.
  for (const email of ['maya@northwind.studio', `maya-${id}@northwind.studio`]) {
    const res = await req.post(`${API}/auth/register`, {
      data: { org_name: 'Northwind Studio', org_slug: `northwind-${id}`, email, password: 'password123', name: 'Maya Chen' },
    });
    if (res.ok()) break;
  }
  const profile = await ok<{ user: { user_id: string } }>(await req.get(`${API}/auth/me`));
  const me: string = profile.user.user_id;

  const labels: Record<string, string> = {};
  for (const [name, color] of [['Design', 'purple'], ['Bug', 'red'], ['Backend', 'blue'], ['Marketing', 'orange'], ['Docs', 'teal']] as const) {
    labels[name] = (await ok(await req.post(`${API}/labels`, { data: { name, color } }))).id;
  }

  type T = [title: string, status: string, priority: string, due: number | null, labels: string[], mine: boolean];
  const projects: [string, string, T[]][] = [
    ['Website Relaunch', 'New marketing site, pricing page and blog, launching in December.', [
      ['Design the new pricing page', 'in_progress', 'high', 3, ['Design'], true],
      ['Hero section copy', 'in_review', 'medium', 1, ['Marketing'], true],
      ['Fix broken links on /blog', 'todo', 'urgent', 0, ['Bug'], true],
      ['Set up analytics events', 'todo', 'medium', 6, ['Backend'], false],
      ['Migrate blog posts to the new CMS', 'in_progress', 'medium', 9, ['Backend', 'Docs'], false],
      ['Newsletter sign-up form', 'todo', 'low', 12, ['Design', 'Marketing'], false],
      ['Lighthouse score above 90', 'todo', 'high', 5, [], true],
      ['Choose the illustration style', 'done', 'medium', -4, ['Design'], true],
      ['Domain and DNS cut-over plan', 'done', 'high', -2, ['Docs'], false],
      ['Write launch announcement', 'in_review', 'medium', 4, ['Marketing', 'Docs'], false],
    ]],
    ['Mobile App v2', 'Offline mode, push notifications and a redesigned onboarding.', [
      ['Offline sync for tasks', 'in_progress', 'urgent', 2, ['Backend'], true],
      ['Onboarding screens', 'todo', 'medium', 8, ['Design'], false],
      ['Crash on Android 14 when rotating', 'todo', 'high', 1, ['Bug'], true],
      ['Push notification settings', 'done', 'low', -6, [], false],
    ]],
    ['Q1 Planning', 'Goals, hiring and budget for next quarter.', [
      ['Draft team OKRs', 'in_progress', 'high', 7, ['Docs'], true],
      ['Hiring plan for two engineers', 'todo', 'medium', 14, [], false],
      ['Budget review with finance', 'done', 'medium', -1, [], true],
    ]],
  ];

  let boardId = '';
  let featured = '';
  for (const [name, description, tasks] of projects) {
    const project = await ok(await req.post(`${API}/projects`, { data: { name, description } }));
    boardId ||= project.id;
    for (const [title, status, priority, due, taskLabels, mine] of tasks) {
      const task = await ok(await req.post(`${API}/projects/${project.id}/tasks`, {
        data: { title, priority, ...(due === null ? {} : { due_date: day(due) }), ...(mine ? { assignee_id: me } : {}) },
      }));
      if (status !== 'todo') await ok(await req.patch(`${API}/projects/${project.id}/tasks/${task.id}`, { data: { status } }));
      if (taskLabels.length) await ok(await req.put(`${API}/projects/${project.id}/tasks/${task.id}/labels`, { data: { label_ids: taskLabels.map((l) => labels[l]) } }));
      if (title === 'Design the new pricing page') {
        featured = title;
        await ok(await req.patch(`${API}/projects/${project.id}/tasks/${task.id}`, {
          data: { description: 'Three plans side by side, yearly/monthly toggle, and an FAQ below. Mobile first; reuse the card component from the design system.' },
        }));
        for (const body of ['First draft is in Figma, feedback welcome before Thursday.', 'Looks great. Can we make the yearly discount more visible?']) {
          await ok(await req.post(`${API}/projects/${project.id}/tasks/${task.id}/comments`, { data: { body } }));
        }
      }
    }
  }
  for (const email of ['sam@example.com', 'priya@example.com']) {
    await req.post(`${API}/invites`, { data: { email, role: 'member' } });
  }
  return { boardId, featured };
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function snap(page: Page, path: string, name: string, theme: 'light' | 'dark') {
  await page.evaluate((t) => localStorage.setItem('openpm-theme', t), theme);
  await page.goto(path);
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
}

test.use({ storageState: { cookies: [], origins: [] } });

test('screenshots', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.goto('/login');
  await settle(page);
  await page.screenshot({ path: `${OUT}/login-light.png` });

  const { boardId, featured } = await seed(page.request);

  for (const theme of ['light', 'dark'] as const) {
    await snap(page, '/dashboard', 'dashboard', theme);
    await snap(page, '/projects', 'projects', theme);
    await snap(page, `/projects/${boardId}`, 'board', theme);
    await page.getByRole('button', { name: `Open task: ${featured}` }).click();
    await expect(page.getByRole('dialog', { name: featured })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${OUT}/task-${theme}.png` });
  }
  await snap(page, '/activity', 'activity', 'light');
  await snap(page, '/settings/organization', 'organization', 'light');
  await snap(page, '/admin', 'admin', 'light');

  // Phone size, same session.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce', storageState: await page.context().storageState(),
  });
  const p = await phone.newPage();
  await p.goto('/login');
  await snap(p, '/dashboard', 'phone-dashboard', 'light');
  await snap(p, `/projects/${boardId}`, 'phone-board', 'light');
  await phone.close();
});
