# Frontend tests

| Kind | Where | Runs |
| --- | --- | --- |
| Unit (logic without a browser) | `apps/frontend/src/**/*.test.ts` (Vitest) | `npm test`, in CI's *Lint, build, test* |
| Browser (Playwright) | `apps/frontend/tests/*.spec.ts` | `npm run test:e2e -w apps/frontend`, in CI's *Browser tests (Playwright)* |

## Browser tests

They drive the real frontend against the real API, Postgres and Redis.

```bash
docker compose up -d api                    # API on :3000 (Postgres, Redis and migrations start with it)
cd apps/frontend
npx playwright install chromium             # once
npx playwright test                         # starts `next dev` on :3001 unless it is already running
npx playwright test --project=phone         # only the phone layout
```

A `setup` step registers one throwaway workspace and saves its session (`tests/.auth/`, gitignored).
The other tests reuse it, so a run stays inside the API's rate limits (10 registrations and 100
requests a minute per address). Every run creates a new workspace; nothing is cleaned up, so use a
development database.

| Spec | Checks |
| --- | --- |
| `journey.spec.ts` | The core journey in a fresh browser: sign up, first-run welcome, create a project, add a task with every field, edit it (status moves the card), delete it after a confirmation. Unsaved edits are not lost on Escape. A task moves with the keyboard (drag handle) and stays moved. Unknown projects and pages say so. |
| `a11y.spec.ts` | axe-core (WCAG 2.1 A and AA rules) on every main screen, the task dialog and a confirmation, at desktop and phone size. |
| `responsive.spec.ts` | Phone (Pixel 7, Chromium): the menu drawer opens, navigates, closes on Escape and returns focus; no page scrolls sideways; the task dialog's Save stays on screen. |
| `login.spec.ts` | The login form renders. |

Locators use roles and accessible names (`getByRole`, `getByLabel`), so a control that loses its
label or role fails a test, not only an accessibility scan.

Environment: `E2E_BASE_URL` (frontend; set it to skip starting the dev server) and `E2E_API_URL`
(default `http://localhost:3000/api`).
