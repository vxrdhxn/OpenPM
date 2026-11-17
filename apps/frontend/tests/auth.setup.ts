import { expect, test as setup } from '@playwright/test';
import { API, unique } from './helpers';

// One throwaway workspace (owner account) for the whole run; its session cookie is saved for the tests.
setup('register a workspace', async ({ page }) => {
  const id = unique();
  const res = await page.request.post(`${API}/auth/register`, {
    data: { org_name: 'E2E Workspace', org_slug: `e2e-${id}`, email: `e2e-${id}@example.com`, password: 'password123', name: 'E2E Owner' },
  });
  expect(res.status(), await res.text()).toBe(201);
  await page.context().storageState({ path: 'tests/.auth/admin.json' });
});
