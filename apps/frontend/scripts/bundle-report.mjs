#!/usr/bin/env node
/**
 * How much JavaScript each page makes the browser download on first load, measured in a real browser
 * (Chromium via Playwright) against a running build, and checked against budgets.
 *
 *   npm run build && npm start                      # in one terminal (or any running deployment)
 *   npm run perf:bundle                             # in another; E2E_BASE_URL / E2E_API_URL to point elsewhere
 *
 * Counts compressed bytes over the wire (what users actually wait for), per page, split into the
 * page's own JS and the lazily loaded 3D chunk. Exits 1 if a page goes over its budget, so CI can
 * gate on it. Signed-in pages use a throwaway workspace registered for the run.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api';

/** Budgets in KB (compressed). Raise one only with a reason in the commit message. */
const BUDGETS = {
  '/': 180,
  '/login': 180,
  '/register': 180,
  '/dashboard': 195,
  '/projects': 195,
  '/admin': 195,
  '/notifications': 190,
  '/settings/organization': 195,
};
/** three.js and the scenes load after the page, only where a scene is shown. Budgeted on their own. */
const THREE_BUDGET_KB = 150;
/** Web fonts (every page uses the same three families). */
const FONT_BUDGET_KB = 160;

const kb = (n) => Math.round(n / 1024);

async function measure(page, path) {
  const js = { page: 0, three: 0, fonts: 0 };
  const onResponse = async (res) => {
    const url = res.url();
    if (url.includes('/_next/static/') && url.endsWith('.woff2')) {
      await res.finished().catch(() => undefined);
      js.fonts += Math.max(0, (await res.request().sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize);
      return;
    }
    if (!url.includes('/_next/static/') || !url.endsWith('.js')) return;
    // Bytes actually received for the body: compressed, as the user's connection carries them.
    await res.finished().catch(() => undefined);
    const size = Math.max(0, (await res.request().sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize);
    // The 3D chunk is recognisable by its content (three.js's renderer); count it apart.
    const body = await res.text().catch(() => '');
    if (body.includes('WebGLRenderer')) js.three += size;
    else js.page += size;
  };
  page.on('response', onResponse);
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  page.off('response', onResponse);
  return js;
}

const browser = await chromium.launch();

/** A first visit: a fresh browser context (empty cache), signed in when `state` is given. */
async function firstVisit(path, state) {
  const context = await browser.newContext(state ? { storageState: state } : {});
  const page = await context.newPage();
  const js = await measure(page, path);
  await context.close();
  return { path, ...js };
}

const rows = [];
for (const path of ['/', '/login', '/register']) rows.push(await firstVisit(path));

// Sign in as a fresh workspace owner for the rest (the session cookie is all that carries over).
const signIn = await browser.newContext();
const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const reg = await signIn.request.post(`${API}/auth/register`, {
  data: { org_name: 'Bundle report', org_slug: `bundle-${id}`, email: `bundle-${id}@example.com`, password: 'password123', name: 'Bundle Report' },
});
if (reg.status() !== 201) {
  console.error(`Could not register a workspace for the signed-in pages (HTTP ${reg.status()}).`);
  process.exit(2);
}
const state = await signIn.storageState();
await signIn.close();
for (const path of ['/dashboard', '/projects', '/admin', '/notifications', '/settings/organization']) rows.push(await firstVisit(path, state));
await browser.close();

let over = false;
console.log('\nFirst-load JavaScript per page (compressed)\n');
console.log('page'.padEnd(26), 'page JS'.padStart(9), 'budget'.padStart(8), '3D (lazy)'.padStart(11), 'fonts'.padStart(8));
for (const r of rows) {
  const budget = BUDGETS[r.path];
  const bad = budget && kb(r.page) > budget;
  const badThree = r.three && kb(r.three) > THREE_BUDGET_KB;
  const badFonts = kb(r.fonts) > FONT_BUDGET_KB;
  over ||= bad || badThree || badFonts;
  console.log(
    r.path.padEnd(26),
    `${kb(r.page)} KB`.padStart(9),
    `${budget ?? '-'} KB`.padStart(8),
    (r.three ? `${kb(r.three)} KB` : '-').padStart(11),
    `${kb(r.fonts)} KB`.padStart(8),
    bad || badThree || badFonts ? '  OVER BUDGET' : '',
  );
}
console.log(over ? '\nA page is over its budget.' : '\nEvery page is within budget.');
process.exit(over ? 1 : 0);
