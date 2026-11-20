# Frontend tests

| Kind | Where | Runs |
| --- | --- | --- |
| Unit (logic without a browser) | `apps/frontend/src/**/*.test.ts` (Vitest) | `npm test`, in CI's *Lint, build, test* |
| Browser (Playwright) | `apps/frontend/tests/*.spec.ts` | `npm run test:e2e -w apps/frontend`, in CI's *Browser tests (Playwright)* |

## Browser tests

They drive the real frontend against the real API, Postgres and Redis.

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d api   # API on :3000, test client not rate-limited
cd apps/frontend
npx playwright install chromium             # once
npx playwright test                         # starts `next dev` on :3001 unless it is already running
npx playwright test --project=phone         # only the phone layout
```

A `setup` step registers one throwaway workspace and saves its session (`tests/.auth/`, gitignored).
The other tests reuse it, so a run makes only two registrations. On a fast machine the suite still
sends more than the API's 100 requests a minute from one address, so `docker-compose.e2e.yml`
exempts the Docker bridge addresses from rate limiting (CI uses it too); without it, expect 429s. Every run creates a new workspace; nothing is cleaned up, so use a
development database.

| Spec | Checks |
| --- | --- |
| `journey.spec.ts` | The core journey in a fresh browser: sign up, first-run welcome, create a project, add a task with every field, edit it (status moves the card), delete it after a confirmation. Unsaved edits are not lost on Escape. A task moves with the keyboard (drag handle) and stays moved. Unknown projects and pages say so. |
| `projects.spec.ts` | A private project: created with *Who can see it*, shows *Private* on its card and board, *People* lists its creator; making a shared project private asks first; it opens to the workspace again. Who sees what across users is in the API's `projectAccess.int.test.ts`. |
| `organization.spec.ts` | In a throwaway workspace: the owner renames it, cannot leave as the only owner, and deletes it (slug and password required, a wrong password refused); the account is gone afterwards. |
| `a11y.spec.ts` | axe-core (WCAG 2.1 A and AA rules) on every main screen, the task dialog and a confirmation, at desktop and phone size. |
| `responsive.spec.ts` | Phone (Pixel 7, Chromium): the menu drawer opens, navigates, closes on Escape and returns focus; no page scrolls sideways; the task dialog's Save stays on screen. |
| `login.spec.ts` | The login form renders. |
| `admin.spec.ts` | The two sign-in doors: `/admin/login` leads to the admin door and an owner lands in the admin area; the member door takes the same account to the dashboard; switching doors; a member at the admin door is told so (the API's own tests cover the real refusal). |
| `errors.spec.ts` | What people see when things fail (injected with `page.route`): a list that cannot load says so and *Try again* recovers; one failed dashboard section does not blank the others; a network failure is reported; a refused move is put back with the reason; a failed save keeps the edits; the offline banner. And undo after delete: Undo brings the task back and nothing is sent; without it the delete goes after the grace period; leaving the page sends it at once. |
| `visual.spec.ts` | Visual regression (opt-in): the signed-out pages and the dark sign-in compared with committed screenshots. See below. |

Locators use roles and accessible names (`getByRole`, `getByLabel`), so a control that loses its
label or role fails a test, not only an accessibility scan.

## Visual regression

```bash
E2E_VISUAL=1 npx playwright test --project=visual                      # compare
E2E_VISUAL=1 npx playwright test --project=visual --update-snapshots   # accept a deliberate change
```

Screenshots live in `tests/visual.spec.ts-snapshots/`, one set per operating system (the file name
ends in `-win32`, `-linux`, ...), because fonts render slightly differently on each. Only the
`-win32` set is committed today; to check in CI, make the `-linux` set once on the CI image and
commit it. 3D canvases are masked (WebGL differs between GPUs) and the pages are signed out, so no
names or dates change between runs. A difference of more than 1% of the pixels fails.

Environment: `E2E_BASE_URL` (frontend; set it to skip starting the dev server) and `E2E_API_URL`
(default `http://localhost:3000/api`).
