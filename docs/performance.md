# Frontend performance

What the browser downloads and asks for when someone opens a page, how it is measured, and the
budgets that keep it from growing by accident.

## Measuring

```bash
cd apps/frontend
npm run build && npm start        # or any running deployment
npm run perf:bundle               # E2E_BASE_URL / E2E_API_URL to point elsewhere
```

`scripts/bundle-report.mjs` opens each page in Chromium as a **first visit** (a fresh browser
context, empty cache) and adds up the bytes actually received (compressed), split into the page's
own JavaScript, the lazily loaded 3D chunk, and web fonts. It exits 1 when anything is over budget,
so CI can gate on it. Signed-in pages use a throwaway workspace registered for the run.

## Where it stands (Nov 2026, production build)

| Page | Page JS | Budget | 3D chunk (lazy) |
| --- | --- | --- | --- |
| `/` (home) | 155 KB | 180 KB | none |
| `/login`, `/register` | 155 KB | 180 KB | 136 KB |
| `/dashboard` | 169 KB | 195 KB | 136 KB (first-run banner) |
| `/projects` | 167 KB | 195 KB | 136 KB (banner) |
| `/admin` | 168 KB | 195 KB | none |
| `/notifications` | 164 KB | 190 KB | none |
| `/settings/organization` | 168 KB | 195 KB | none |

Fonts are 224 KB in all (18 files, Latin subset); a page fetches only the files its text uses
(20 to 82 KB in practice). Budgets: 150 KB for the 3D chunk, 160 KB of fonts per page.

## What keeps it small

- **three.js loads only where a scene is shown.** `ThreeScene` imports the engine (and three.js)
  when it mounts, as its own chunk; the home page has no scene and never downloads it.
- **Dialogs and the command palette load on first open** (`next/dynamic`): the task, project and
  people dialogs, and Ctrl+K.
- **The home page is a server component** with small client islands (header, rulers, scroll
  effects, the feature fan, the call to action).
- **Client components are client for a reason.** Every `'use client'` file uses state, effects,
  event handlers or browser APIs (audited Nov 2026). The signed-in app renders on the client because
  every page reads the signed-in user's data through the API with their session cookie.
- **Fonts are self-hosted** by `next/font` (no request to Google at run time), Latin only, with
  `display: swap`. Space Grotesk and Bricolage Grotesque are variable fonts (one file holds every
  weight); IBM Plex Mono names the two weights it uses.
- **No images in the bundle**: the decoration is CSS, SVG icons (tree-shaken `lucide-react`) and 3D.

## Requests

The signed-in layout loads the user once (`GET /profile/me`) and shares it with every page through
`useMe()` (`components/me.tsx`). Before, pages asked again (`/auth/me` or `/profile/me`): opening the
dashboard, a board, the admin area or the projects list now makes one request fewer each (9 → 8,
8 → 7, 9 → 8, 5 → 4). The calls that remain repeated are different queries (the dashboard's three
task lists, the admin area's two audit views, the projects page and the sidebar's recent boards).

## Re-renders

- **Board cards are memoized** (`BoardCardContent`): typing in the board's search or a live event
  re-renders the board, but a card re-renders only when its own task changes. Moves and undo keep
  unchanged tasks' object identity, so only the cards that moved re-render.
- **The motion layer never re-renders**: the cursor ring and click bursts are driven through refs
  and the DOM, not React state.
- **3D scenes take live data without remounting** (`ThreeScene`'s `data` prop is compared by
  content, and the scene updates in place).
