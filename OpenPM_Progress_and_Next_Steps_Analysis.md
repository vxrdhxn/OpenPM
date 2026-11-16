# OpenPM — System Status, Architectural Audit & Actionable Roadmap

**Date:** November 15, 2026 (audited against commit `c0c3cbc`)
**Repository:** `OpenPM`
**Status Overview:** Build, lint and test clean on Node 22 🟢 | Phases A–E + F.1/F.2 implemented 🟢 | Never deployed 🟡

The detailed checklist is in `OpenPM_MASTER_ROADMAP.md` (section 36 has the per-area summary). This document gives the overview and the next steps.

---

## 1. Executive Summary

OpenPM is designed as an open-source, self-hostable, enterprise-grade, Kubernetes-native project management platform built to compete with Jira and Linear.

All three workspace apps (`apps/api`, `apps/worker`, `apps/frontend`) build, lint and pass their tests (~315 test cases) on Node 22. Production-readiness Phases A–E (security, tests, migrations, scaling/attachments, observability/CI) are implemented. In November 2026 every dependency with an advisory was upgraded and npm audit is clean.

What still stands between the project and production:

1. **Kubernetes is only proven on kind.** The chart now installs, upgrades and rolls back on a local cluster (G.4). ArgoCD, an Ingress controller and HPA scaling are still unverified, and there is no real cloud deployment yet.
2. **The missing product features (Phase I).** Phases F (broken user flows) and H (hardening) are complete.

---

## 2. Completed Work Overview

```
+-----------------------------------------------------------------------------------+
|                                 OpenPM Architecture                               |
+-----------------------------------------------------------------------------------+
|  [ Frontend - Next.js 16 ]  <--- (WebSockets / HTTP) --->  [ API - Fastify 5 TS ]  |
|    - Kanban Board UI, React 19                               - JWT Auth & RBAC    |
|    - Task dialog + attachments                               - REST & WS Gateway  |
|    - Settings & Password Reset                               - Prometheus Metrics |
+-----------------------------------------------------------------------------------+
                                  |                              |
                          [ S3 / MinIO ]           +-------------+-------------+
                          - Attachments            |                           |
                                           [ PostgreSQL ]                [ Redis ]
                                           - Multi-Tenant Data           - Cache + Queue Broker
                                           - Reversible Migrations       - WS Pub/Sub Backplane
                                                                               |
                                                                        [ BullMQ Worker ]
                                                                        - Assignment email (Resend)
                                                                        - Queue metrics
+-----------------------------------------------------------------------------------+
|                   DevOps & Kubernetes Infrastructure                              |
|  Docker multi-stage | Helm (HPA, PDB, NetworkPolicy, ServiceMonitor, alerts)      |
|  ArgoCD app-of-apps (dev/prod) | GitHub Actions CI | Grafana dashboards           |
+-----------------------------------------------------------------------------------+
```

### 2.1 Backend API (`apps/api`)
- **Core server:** Fastify 5 with TypeScript (strict), environment validation with zod, helmet, strict CORS, 1 MB body limit, global and auth-specific rate limits, request IDs (`X-Request-Id`), graceful shutdown.
- **Database:** `pg` pool and 9 reversible SQL migrations (`migrate`, `migrate:down`, `migrate:status`): organizations, users, projects, tasks, activity_log, organization_invites, password_reset_tokens, query indexes, task_attachments. Multi-step writes use `withTransaction`. Docker Compose runs the migrations before the API and worker start.
- **Authentication:** bcrypt, a 24h JWT in an httpOnly SameSite=strict cookie, register/login/logout, a forgot/reset-password API (no email delivery, see 3.1), `JWT_SECRET` required in production.
- **Authorization:** `requireRole` (owner > admin > member > viewer) on every route. The organization always comes from the JWT, never from the request.
- **Endpoints:** projects (CRUD plus archive/restore), tasks (CRUD, assignment, status, priority, due date), attachments (presigned upload, complete, list, download, delete), invites (create, list, revoke), profile.
- **Real-time:** `/ws` authenticated by cookie or Bearer header, with an Origin check, one channel per org, heartbeat, close on JWT expiry, and one shared Redis subscriber per pod (`RealtimeHub`).
- **Observability:** structured JSON logs with user/org/request ids and redaction; metrics for HTTP, DB latency and pool, auth failures, WebSocket and Redis errors.

### 2.2 Background Worker (`apps/worker`)
- BullMQ consumer for the `tasks` queue. Its only job is `task_created`, which emails the assignee through **Resend**. When `RESEND_API_KEY` is unset, mail is printed in development and suppressed in production.
- Logs carry `job_id` and the originating `request_id`. A metrics endpoint exposes job outcomes and durations, queue depth, queue lag and email results.

### 2.3 Web Frontend (`apps/frontend`)
- Next.js 16 App Router, React 19, Tailwind. The middleware is renamed to `proxy.ts` (the Next 16 convention).
- Login, registration, forgot/reset-password pages; projects list; Kanban board with drag-and-drop status changes and live updates over WebSocket (reconnects with backoff).
- Accessible task detail dialog with an attachments panel (drag and drop, progress, cancel, confirmed delete).
- Organization settings (create/revoke invites) and profile settings.

### 2.4 DevOps & Kubernetes
- Multi-stage, non-root Alpine images for the API, worker and frontend; `.dockerignore`; Docker Compose with Postgres, Redis and MinIO (a maintained image; `quay.io/minio` now returns 401).
- Helm chart: restricted pod security context, probes, HPA, PDB, default-deny NetworkPolicy with explicit DB/Redis/DNS rules and HTTPS egress (for email and S3), ServiceMonitors, 2 Grafana dashboards, 18 alert rules (`PrometheusRule`).
- ArgoCD app-of-apps for dev and prod.
- CI (`.github/workflows/ci.yml`): `npm ci`, lint, build, test; Helm lint/render for three value sets plus promtool checks on the alerts; gitleaks over the full history; per-image build and Trivy scan. Actions are pinned to SHAs, and Dependabot covers npm, Docker and Actions.

---

## 3. Gap Analysis & Technical Debt

### 3.1 Broken or missing product flows (🔴 High)

| Gap | Detail |
| :--- | :--- |
| Member management | Done (I.1), except ownership transfer, reactivation and org deletion. |
| Product gaps after Phase I | Ownership transfer, reactivation, org deletion; due-date reminders and notification preferences; no browser review of the new UI yet. |

### 3.2 Hardening (🟡 Medium)

| Area | Current state | Gap |
| :--- | :--- | :--- |
| Auth | 24h JWT, revocable via token_version (H.3) | Password change does not ask for the current password. Register can still be told apart from success without email verification. |
| Input validation | Body and path-param schemas (H.1) | WebSocket payloads are not validated. |
| Audit log | `activity_log` for project/task changes | Project deletion, auth and membership events are not recorded; there is no `request_id` column and no read endpoint. |
| Attachments | See `docs/attachments.md` | No malware scanning, no reaper for abandoned pending uploads, no retention or quotas. |
| Helm / ArgoCD | Lint and render checked | `values.yaml` ships dev secrets; no `values.schema.json`; prod auto-syncs from `HEAD`. |
| Docker | Hardened images | The runtime stage uses `npm install --omit=dev`, not `npm ci`; the worker image has no healthcheck; no tag strategy. |
| Docs | README, guides | Permissions, WebSocket events, threat model and backup/rollback are not documented. |

### 3.3 Verification debt (🟡 Medium)

Never run outside tests or Compose: two API replicas sharing live updates, attachments against real S3/MinIO in a browser, `migrate:down` against real Postgres, the Helm chart on a cluster, ArgoCD sync, and the dashboards and alerts in live Prometheus/Grafana. CI has not yet been confirmed green on GitHub. There are no integration tests against real Postgres, no E2E beyond one Playwright login spec, and no load tests.

---

## 4. Completed Phases

### Phase A: RBAC, Security & Tenant Isolation (Completed 🟢)
- [x] **Task A.1:** Centralized authorization middleware in `apps/api/src/plugins/auth.ts` (`authenticate`, `requireRole`).
- [x] **Task A.2:** Every route derives `org_id` from the authenticated session; client-supplied values are never trusted.
- [x] **Task A.3:** IDOR / cross-tenant boundary tests (route level, mocked DB).

### Phase B: Test Suite Expansion (Completed 🟢)
- [x] **Task B.1:** Authentication flow tests (register, login, password reset).
- [x] **Task B.2:** Task and project lifecycle tests.
- [x] **Task B.3:** Worker tests (job dispatch, email sending, metrics).

### Phase C: Database & Migration Framework (Completed 🟢)
- [x] **Task C.1:** Reversible migrations (`migrate`, `migrate:down [n]`, `migrate:status`). Compose now runs them on startup; `migrate:down` has not been exercised against a live Postgres.
- [x] **Task C.2:** Query indexes (migration `008_query_indexes`).
- [x] **Task C.3:** `withTransaction` wraps every multi-step write.

### Phase D: Multi-Node Scaling & Attachments (Completed 🟢, pending live verification)
- [x] **Task D.1:** Redis Pub/Sub backplane for WebSocket delivery (`RealtimeHub`), cookie auth, Origin check, heartbeat, expiry close, client reconnect with backoff.
- [x] **Task D.2:** Attachments in S3-compatible storage with presigned uploads, allowlist, magic-byte verification and file cleanup on delete (`docs/attachments.md`).
- [x] **Task D.3:** Frontend attachments UI in an accessible task dialog.

### Phase E: Production Readiness & Observability (Completed 🟢, pending live verification)
- [x] **Task E.1:** Structured JSON logging with request correlation from the API through to the worker.
- [x] **Task E.2:** Metrics, 2 Grafana dashboards, and 18 promtool-tested alert rules (`docs/observability.md`).
- [x] **Task E.3:** GitHub Actions CI with Dependabot (`docs/ci.md`).

### Since Phase E (November 2026)
- [x] **Dependency upgrades:** Node 22, Fastify 5, Next 16, React 19, Zod 4, Vitest 5, BullMQ 6, bcrypt 6, Resend 6, ESLint 9 (flat config). All npm audit advisories cleared. Regressions found by running the app were fixed (b707781).
- [x] **Helm NetworkPolicy:** the worker and API are allowed HTTPS egress (email provider, S3).
- [x] **`JWT_SECRET`:** required in production, checked when the API starts (migrations don't need it).
- [x] **Compose:** migrations run before the API and worker start; MinIO moved to a maintained image.
- [x] **Lint warnings cleared;** Fastify `requestIdLogLabel` deprecation fixed.

---

## 5. Next Steps (Prioritized)

### Phase F: Close the broken user flows
- [x] **F.1 Invite acceptance (done):** an `invite_created` job emails the link (`APP_URL`); invite tokens are stored as SHA-256 hashes (migration 010); public `POST /api/invites/lookup` and `/accept` (rate-limited, token in the body, org/role/email from the invite, `FOR UPDATE` against double accepts); an `/invite` page; activity log entries for created/revoked/accepted. Helm now passes `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` to the worker (it never did, so no email could be sent in Kubernetes). The frontend proxy no longer redirects signed-out users away from `/invite`, `/forgot-password` and `/reset-password`. Verified on real Postgres via Docker Compose, including migration 010 down/up. Note: failed emails are still not retried (F.3).
- [x] **F.2 Password-reset email (done):** `forgot-password` replies first (uniform timing), then stores a hashed token (migration 011), invalidates older links and queues `password_reset_requested`; the worker emails `${APP_URL}/reset-password?token=…` only if that token is still valid. `reset-password` validates the token format, matches the hash with `FOR UPDATE`, consumes all of the user's links and records `password_reset` in `activity_log`. Rate limits: forgot 5/min, reset 10/min. Verified on real Postgres via Docker Compose. Also fixed: Vitest 5 collected compiled tests from `dist/`, which would fail CI (build runs before test). Still open: a reset does not end existing sessions (no token revocation, H.3).
- [x] **F.3 Worker job policy (done):** every job gets 5 attempts with exponential backoff (30s → 4m) and is trimmed from Redis afterwards. Email failures now fail the job: temporary ones (network, 15s timeout, rate limit, 5xx) are retried; permanent ones (invalid recipient or API key) and malformed payloads fail at once (`UnrecoverableError`). Sends carry a per-job idempotency key, so retries cannot deliver duplicates. Worker lookups are scoped to the job's `org_id`. Unknown job names fail retryably instead of being dropped. Concurrency is 5. `worker_jobs_total` gains `status="retrying"`, so `OpenPMJobsFailing` only fires when a job gives up, and `OpenPMEmailsFailing` needs 5 failures in 15m. See `docs/jobs.md`. Verified live: with Postgres cut off, attempt 1 failed and attempt 2 succeeded 30s later; a malformed job failed after one attempt.

### Phase G: Verify for real
- [x] **G.1 CI on GitHub (done, except branch protection):** every job has been green on GitHub since 2026-11-15. Trivy is now blocking (`TRIVY_EXIT_CODE: "1"`). Turning it on failed all three images: 10 HIGH advisories in the npm CLI bundled with `node:22-alpine` (brace-expansion, ip-address, pacote, picomatch, sigstore), not in OpenPM's dependencies. Nothing runs npm in the containers, so the runtime stages now delete npm, yarn and corepack; builds also use `npm ci`. **Still to do (repo admin, in GitHub settings):** mark the seven CI checks as required on `main`; the exact settings are in `docs/ci.md`.
- [x] **G.2 Real-database tests (done):** `npm run test:integration` drives the real app (`buildApp()`, split out of `index.ts`) against a throwaway Postgres database, in CI via a Postgres service container. Each run applies every migration, rolls all of them back to an empty schema and applies them again. 29 tests cover tenant isolation (each cross-org read/write/delete returns 404 and the row is unchanged), roles, privilege escalation, register/login, password reset, invites and rate limits. **Found and fixed a cross-tenant bug:** tasks could be assigned to a user from another organization (only the foreign key was checked), which put that user's name on the other org's board. Redis and the queue are in-memory fakes. actionlint now runs clean on the workflow.
- [x] **G.3 Full-stack rehearsal (done):** new opt-in overlays `docker-compose.scale.yml` (second API on :3002) and `docker-compose.monitoring.yml` (Prometheus + Grafana with the chart's own rules and dashboards). Verified with a real browser:
  - Live updates cross API instances in both directions.
  - Attachments upload, download (cross-origin from MinIO) and delete.
  - Both API instances and the worker are scraped; all 18 rules evaluate.
  - `OpenPMWorkerDown` fired after 2 min and cleared on restart, and a job queued during the outage ran afterwards.
  - Every dashboard query was run against live data.

  **Found and fixed:** every DELETE from the UI returned 400 (the API client sent a JSON content type with no body), so deleting attachments and revoking invites in the browser never worked. Ratio panels showed "No data" instead of 0%. Details: `docs/rehearsal.md`.
- [x] **G.4 Kubernetes on kind (done, except ArgoCD):** installed with default values, upgraded (revisions 2–10) and rolled back from a broken image, with the app flow, worker jobs, NetworkPolicy enforcement and a browser session verified in the cluster. **The chart had never installed or worked.** Fixed:
  - Postgres and Redis NetworkPolicies rendered without `apiVersion`.
  - Postgres crash-looped; it now runs as non-root.
  - No migrations ran; the API now has an init container for them.
  - Config changes didn't roll pods; checksum annotations added.
  - The frontend called `localhost:3000` in every cluster; production builds now default to same-origin URLs.
  - A 401 caused an endless reload loop.

  A new CI test (`tests/helm`) guards these. See `docs/rehearsal.md`.
- [ ] **G.5 Remaining cluster checks:** ArgoCD sync and drift, a real Ingress controller, and HPA with metrics-server. Applying their upstream manifests needs your approval (see the G.4 notes).

### Phase H: Hardening
- [x] **H.1 (done):** `plugins/errors.ts` gives every response the `{ error }` shape (validation, unknown routes, rate limits included); 5xx bodies say only "Internal server error" and the details go to the log. `plugins/uuidParams.ts` requires every `:id`/`:*Id` param to be a UUID, so a malformed id is a 400 instead of a Postgres cast error surfacing as a 500 (authentication still runs first). `requestTimeout` is 30s (Node default 5 min) and the API pool sets a 10s Postgres `statement_timeout`. On SIGTERM the API stops HTTP and WebSockets, then closes the job queue, both Redis clients and the pg pool, logging failures without blocking the rest, with a forced exit at 25s (`shutdown.ts`). Covered by unit tests and a new integration file (`apiErrors.int.test.ts`); green in CI.
- [x] **H.2 (done):** the cache client no longer queues commands while disconnected or replays them after reconnecting, and each command has a 250ms deadline, so a Redis outage no longer makes requests hang. `get` misses, `set`/`del`/`publish` never throw (a write no longer fails after its DB commit), invalidations missed during the outage are retried on reconnect, and skips are counted in `cache_bypassed_total`. **Also fixed:** liveness, readiness and startup all used `/health`, which returned 503 without Redis, so an outage would have restarted every API pod. Liveness now uses a new `/health/live`; `/health` returns 200 `degraded` when only Redis is down (503 only without Postgres). Unit tests, an integration file (`redisOutage.int.test.ts`) and a Helm render test; green in CI. Not yet verified against a real Redis outage (Compose or kind), and enqueueing jobs while Redis is down is unverified.
- [x] **H.3 (done):** sessions are revocable. Migration 012 adds `users.token_version`; session JWTs carry it (`tv`) and every authenticated request compares it with the user's row (scoped to user and org). Logout, password change and password reset bump it, ending every session on every device; a password change re-issues the caller's own cookie. WebSockets check at connect and on every heartbeat and close with `Session revoked`. The same lookup returns the current role, so demotions and deleted users take effect on the next request instead of after 24h. Tokens from before the migration count as version 0. Register answers a taken email and a taken slug with one message. Unit tests, plus `sessions.int.test.ts` against Postgres. Remaining: changing the password does not require the current one, and full non-enumeration on register needs verify-by-email sign-up.
- [x] **H.4 (done):** `.github/workflows/codeql.yml` analyses `javascript-typescript` and `actions` with `security-extended` queries on PRs, pushes and weekly; green on GitHub. The README no longer claims a k6 script, `grafana/`/`k6/` directories or a nonexistent metric. **Still to do (repo admin):** review the first CodeQL alerts (Security → Code scanning) and add a code-scanning rule so findings block merges (`docs/ci.md`).

### Phase I: Core product
- [x] **I.1 Member management (done):** `/api/members` list, role change, remove and leave, with a Members panel in organization settings. You must outrank whom you change (owners may manage owners), cannot grant above your own role, and cannot change yourself; the last admin/owner cannot leave, and the organization row is locked so concurrent changes cannot break that. Removal deactivates the account (migration 013) instead of deleting it, since creators are referenced by NOT NULL keys and the activity log would cascade away: sessions and sockets end, tasks are unassigned, the email is freed for re-invites and the name stays in history. Audited in `activity_log`; rules in `docs/members.md`; `members.int.test.ts` against Postgres. Not done: ownership transfer, reactivation, org deletion.
- [x] **I.2 Pagination and filtering (done):** keyset pagination (`{ items, next_cursor }`, limit ≤ 100, validated opaque cursors that keep Postgres' microsecond timestamps so no row is skipped) on `GET /api/projects` (name search, status) and a new org-wide `GET /api/tasks` (project, status, priority, assignee me/none/id, due range, text; sort by created/updated/due/priority). The board takes the same filters and is capped at 1000 tasks. Unknown query parameters are a 400. Projects page: search, status filter, Load more; board: filter bar. Migration 014 adds indexes. `docs/pagination.md`; `pagination.int.test.ts` against Postgres. Not measured under load.
- [x] **I.3 Comments (done):** `/api/projects/:projectId/tasks/:taskId/comments` (migration 015). Viewers read, members post, only the author edits (marked edited), the author or an admin deletes. Plain text up to 10,000 characters, rendered as text. Newest-first pagination; live `comment_created/updated/deleted` events applied idempotently in the task dialog; `activity_log` records each change without the text. A removed member's comments stay, marked removed. `docs/comments.md`; `comments.int.test.ts` against Postgres. No mentions yet.
- [x] **I.4 Labels (done):** org-wide labels (migration 016) with case-insensitive unique names and a fixed color palette; viewers read, members create/rename/recolor, admins delete. `PUT .../tasks/:taskId/labels` replaces a task's set (≤ 20, all from the caller's org, task row locked). Tasks carry labels on the board and in search, and both filter by label. Label changes drop the affected cached boards and publish `labels_changed`. UI: chips on cards, picker in the task dialog, Labels panel in settings, label filter. `docs/labels.md`; `labels.int.test.ts` against Postgres.
- [x] **I.5 Dashboard (done):** `/dashboard` is the landing page: stat tiles (my open, overdue, due in 7 days, active projects), assigned to me, upcoming deadlines, recently updated, project progress (meter list) and an activity feed. New `GET /api/dashboard` and `GET /api/activity` (product events only, org-scoped, paginated); task and project deletions now log their names. Colors from the dataviz palette, validated against the card surfaces. `docs/dashboard.md`; `dashboard.int.test.ts` against Postgres. Not yet reviewed in a browser.
- [x] **I.6 Notifications (done):** notifications for assignment (create/reassign), @mentions, comments and status changes, written in the triggering transaction; never for your own action, never to removed members or other orgs. `@` autocomplete sends validated `mention_ids`; edits notify only new mentions. `/api/notifications` (list, unread count, mark read/all); a content-free live `notification` event, one shared WebSocket for the app, a sidebar badge and a `/notifications` page. Migration 018; `docs/notifications.md`; `notifications.int.test.ts` against Postgres. Not done: due-date reminders, preferences, retention.

**Phase I is complete.** Remaining product gaps: ownership transfer, org deletion, due-date reminders, notification preferences.

---

## 6. Summary Matrix

| Component | Status | Next Milestone |
| :--- | :---: | :--- |
| **Foundation & Build** | 🟢 Complete | Make CI checks required in branch protection |
| **API Backend & RBAC** | 🟢 Solid | Load tests and failure testing (Phase 9) |
| **Organizations & Invites** | 🟢 Solid | Ownership transfer, org deletion |
| **Authentication** | 🟢 Solid | Require the current password to change it; verify-by-email sign-up |
| **Background Worker** | 🟢 Solid | Restart/crash tests under load (Phase 9) |
| **Frontend UI** | 🟢 Functional | Invite-accept page, member management |
| **Kubernetes & DevOps** | 🟢 Works on kind | ArgoCD, Ingress and HPA (G.5) |
| **Observability** | 🟢 Verified locally | Run on a cluster with the Prometheus Operator (G.4) |

### Recommended Immediate Action
1. **Repo settings (admin):** enable branch protection on `main`, review the first CodeQL alerts and make them merge-blocking (see `docs/ci.md`).
2. **G.5:** ArgoCD, Ingress controller and HPA on the kind cluster (needs approval to apply upstream manifests).
