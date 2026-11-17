import { test, expect } from '@playwright/test';

// Signed out: the shared session would send /login straight to the dashboard.
test.use({ storageState: { cookies: [], origins: [] } });

test('has title and login form', async ({ page }) => {
  await page.goto('/login');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/OpenPM/);

  // Expect the login form to be visible.
  await expect(page.locator('form')).toBeVisible();
  
  // Expect email and password inputs
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('pages cannot be framed by other sites and do not advertise the server', async ({ page }) => {
  const response = await page.goto('/login');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('a fresh script nonce on every page, and injected markup cannot run code', async ({ page }) => {
  const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];
  const first = await page.goto('/login');
  const csp = first!.headers()['content-security-policy'];
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  const nonce = nonceOf(csp);
  expect(nonce).toBeTruthy();
  // Next.js put this request's nonce on its scripts (in the HTML: browsers hide the attribute from
  // the DOM), and they ran: the form is interactive.
  expect(await first!.text()).toContain(`nonce="${nonce}"`);
  await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled();

  const second = await page.goto('/login');
  expect(nonceOf(second!.headers()['content-security-policy'])).not.toBe(nonce);

  // An XSS-style injection: markup with an inline event handler is blocked, and reported.
  const outcome = await page.evaluate(async () => {
    const w = window as unknown as { __ran?: boolean };
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
    const div = document.createElement('div');
    div.innerHTML = '<img src="data:," onerror="window.__ran = true">';
    document.body.appendChild(div);
    await new Promise((r) => setTimeout(r, 300));
    return { ran: !!w.__ran, violations };
  });
  expect(outcome.ran).toBe(false);
  expect(outcome.violations).toContain('script-src-attr');
});
