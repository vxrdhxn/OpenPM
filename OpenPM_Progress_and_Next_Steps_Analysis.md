# OpenPM — System Status, Architectural Audit & Actionable Roadmap

**Date:** October 5, 2026  
**Repository:** `OpenPM`  
**Status Overview:** Baseline Operational 🟢 | Build & Lint & Test Clean 🟢 | Phase 1-5 Core Implemented 🟢

---

## 1. Executive Summary

OpenPM is designed as an open-source, self-hostable, enterprise-grade, Kubernetes-native project management platform built to compete with Jira and Linear. 

Over recent development, the project has transitioned into a functional full-stack architecture with containerization and GitOps deployment manifests. All three workspace microservices (`apps/api`, `apps/worker`, `apps/frontend`) compile without errors, pass linting checks, and execute automated tests cleanly.

This document provides a comprehensive breakdown of:
1. **What has been accomplished so far** (by subsystem and feature area).
2. **Current system baseline verification**.
3. **Identified technical debt, security gaps, and risks**.
4. **Detailed, prioritized step-by-step next steps** to reach production readiness.

---

## 2. Completed Work Overview

```
+-----------------------------------------------------------------------------------+
|                                 OpenPM Architecture                               |
+-----------------------------------------------------------------------------------+
|  [ Frontend - Next.js 14 ]  <--- (WebSockets / HTTP) --->  [ API - Fastify TS ]    |
|    - Kanban Board UI                                         - JWT Auth & RBAC    |
|    - App Router & Tailwind                                   - REST & WS Gateway  |
|    - Settings & Password Reset                               - Prometheus Metrics |
+-----------------------------------------------------------------------------------+
                                                                 |
                                                   +-------------+-------------+
                                                   |                           |
                                           [ PostgreSQL ]                [ Redis Cache ]
                                           - Multi-Tenant Data           - Queue Broker
                                           - Migrations                  - WS PubSub Context
                                                                               |
                                                                        [ BullMQ Worker ]
                                                                        - Email Alerts
                                                                        - Async Events
+-----------------------------------------------------------------------------------+
|                   DevOps & Kubernetes Infrastructure                              |
|  - Docker Multi-Stage Builds | Helm Charts | ArgoCD App-of-Apps GitOps           |
+-----------------------------------------------------------------------------------+
```

### 2.1 Backend API (`apps/api`)
- **Core Server & Middleware:** Fastify engine with TypeScript, custom config schema validation (`zod`), CORS, cookie parsing, and correlation tracking.
- **Database & Data Access Layer:** PostgreSQL client connection pool (`pg`) with initial schema migrations for `users`, `organizations`, `organization_memberships`, `projects`, `tasks`, `comments`, `invites`, and `password_reset_tokens`.
- **Authentication & Security:** JWT-based authentication plugin with password hashing (`bcrypt`), cookie token storage, registration (`/api/auth/register`), login (`/api/auth/login`), and password reset workflow (`/api/auth/forgot-password`, `/api/auth/reset-password`).
- **Domain API Endpoints:**
  - **Projects API (`/api/projects`):** Full CRUD for projects, organization filtering, user membership management.
  - **Tasks API (`/api/tasks`):** Create, update, delete, assign tasks, update status/priority, auto-log activity events.
  - **Invites API (`/api/invites`):** Organization invite issuance and acceptance flow.
  - **Profile API (`/api/profile`):** User metadata management and organization list fetching.
- **Real-Time Communication:** Fastify WebSockets integration (`/ws`) for broadcasting real-time task creation/updates to connected clients.
- **Observability:** `/health` endpoint returning system health and database ping, plus `/metrics` returning Prometheus-compatible telemetry.

### 2.2 Background Worker (`apps/worker`)
- **Queue System:** BullMQ queue listener connected to Redis.
- **Event Handlers:** Asynchronous job processors for `taskCreated` notifications and user activity events.
- **Email Gateway:** Nodemailer integration (`src/lib/email.ts`) for sending transactional emails (invitations, password reset links, task updates).

### 2.3 Web Frontend UI (`apps/frontend`)
- **Framework & Styling:** Next.js 14 App Router, TypeScript, and Tailwind CSS with custom theme styling.
- **Authentication Flows:** Dedicated responsive pages for Login, Registration, Forgot Password, and Password Reset.
- **Interactive Kanban Board:** Full task management interface at `/projects/[id]` displaying column-based status organization (BACKLOG, IN_PROGRESS, IN_REVIEW, DONE), task detail modals, creation dialogs, and instant filter updates.
- **Real-Time WebSockets Client:** Custom React hook establishing persistent WebSocket connections to reflect multi-user task updates without page refreshes.
- **Organization & User Settings:** Settings views at `/settings/organization` (member listing, invite management) and `/settings/profile`.

### 2.4 DevOps & Kubernetes Infrastructure
- **Containerization:** Multi-stage production-ready Dockerfiles for both `apps/api` and `apps/frontend` featuring unprivileged runtime users and HTTP healthchecks. Unified local execution via `docker-compose.yml` (PostgreSQL, Redis, API, Worker, Frontend).
- **Helm Configuration:** Modular Kubernetes Helm chart (`helm/openpm`) configured for automated deployments with configurable replicas, ingress rules, secret management, and resource requests/limits.
- **GitOps Integration:** ArgoCD App-of-Apps structure (`argocd/`) enabling declaratively managed environment pipelines (staging vs. production).

### 2.5 Engineering Baseline & Verification
- **Code Quality:** Configured workspace-wide ESLint and TypeScript compilation.
- **Automated Testing:** Vitest integration test suite for API health and routes.
- **Build Status:** Clean execution of `npm run build`, `npm run lint`, and `npm test` across all workspaces with zero errors.

---

## 3. Gap Analysis & Technical Debt

While core functional building blocks are operational, achieving **production readiness** requires addressing the following key gaps:

| Area | Current State | Target Standard / Gap | Priority |
| :--- | :--- | :--- | :--- |
| **Multi-Tenancy & Authorization** | Basic `org_id` filtering in individual SQL queries. | Automated DB-level or middleware-enforced tenant guard to strictly eliminate IDOR/BOLA risks. | 🔴 **High** |
| **RBAC Security** | Roles exist in schema (`Owner`, `Admin`, `Member`, `Viewer`). | Granular permission check middleware enforced on every mutating API route. | 🔴 **High** |
| **Database Migrations** | Raw SQL migration runner script (`migrate.ts`). | Production-grade migration engine (Prisma or Drizzle) with rollback support and schema validation. | 🟡 **Medium** |
| **WebSocket Scale-Out** | Single-node in-memory WebSocket client broadcasting. | Redis Pub/Sub backplane (`@fastify/redis` / Socket.io Redis adapter) for multi-pod scaling. | 🟡 **Medium** |
| **Test Coverage** | Initial Vitest test suite (`health.test.ts`). | Comprehensive unit & integration tests covering auth, tenant boundary, task updates, worker queues, and frontend hooks. | 🔴 **High** |
| **File Storage** | No attachment handling. | MinIO / S3 integration for uploading and serving task attachment files securely. | 🟢 **Enhancement** |
| **Observability & Dashboards** | Raw `/metrics` Prometheus endpoint exposed. | Grafana dashboards, alerting rules, and structured JSON logs with correlation/trace IDs. | 🟡 **Medium** |

---

## 4. Prioritized Next Steps Roadmap

Tasks are divided into immediate, near-term, and production release phases:

### Phase A: RBAC, Security & Tenant Isolation (Completed 🟢)
- [x] **Task A.1:** Implement centralized authorization middleware in `apps/api/src/plugins/auth.ts` to verify organization membership and role permissions (`Owner`, `Admin`, `Member`, `Viewer`) before entering route logic.
- [x] **Task A.2:** Audit every route in `apps/api/src/routes/` (`projects.ts`, `tasks.ts`, `invites.ts`, `profile.ts`) to ensure client-supplied `org_id` parameters can never override authenticated session context.
- [x] **Task A.3:** Add explicit IDOR / cross-tenant boundary security tests ensuring User A from Org A cannot read or mutate resources owned by Org B.

### Phase B: Test Suite Expansion (Completed 🟢)
- [x] **Task B.1:** Create integration test suites for Authentication flows (`register`, `login`, `password-reset`).
- [x] **Task B.2:** Create task & project lifecycle integration tests (`apps/api/src/routes/tasks.test.ts`).
- [x] **Task B.3:** Create worker process unit tests testing BullMQ payload consumption and Nodemailer dispatch mocks (`apps/worker`).

### Phase C: Database & Migration Framework Polish (Completed 🟢)
- [x] **Task C.1:** Standardize schema migrations with rollback support. (`npm run migrate`, `migrate:down [n]`, `migrate:status`; unit-tested with a fake client — not yet exercised against a live Postgres.)
- [x] **Task C.2:** Add indexes for foreign key lookups. Migration `008_query_indexes` adds `tasks(project_id, created_at)`, `projects(org_id, created_at DESC)`, `password_reset_tokens(user_id)` and `activity_log(user_id)`. `organization_memberships` does not exist (users carry a single `users.org_id`), so that index is N/A until a membership model is introduced. Not yet run against a live Postgres.
- [x] **Task C.3:** Add database transaction wrappers around multi-step operations. `withTransaction` (`apps/api/src/db/transaction.ts`) now backs every transactional route (auth, projects, tasks): commit on success, rollback on throw without masking the original error, client always released.

### Phase D: Multi-Node Scaling & Media Attachments (Completed 🟢, pending live verification)
- [x] **Task D.1:** Redis Pub/Sub backplane for multi-pod WebSocket delivery. One shared, ref-counted subscriber per pod (`RealtimeHub`) instead of one Redis connection per client; cookie auth + Origin check; heartbeat; close on JWT expiry; no subscription leak on early disconnect; frontend reconnects with backoff. Unit-tested incl. real-socket route tests; not yet exercised against a live Redis or across two running pods.
- [x] **Task D.2:** File attachments via S3-compatible storage with presigned uploads, at `/api/projects/:projectId/tasks/:taskId/attachments` (project-scoped like every task route). Allowlist, extension and size limits, random storage keys, magic-byte verification on completion, org-scoped authorization on every operation, forced-download headers, and file cleanup when a task or project is deleted. See `docs/attachments.md`. Tested with a fake store; **not yet run against real S3/MinIO**. Not done: malware scanning, an orphan reaper, retention and quotas.
- [x] **Task D.3:** Frontend attachments UI. Cards on the board now open an accessible task detail dialog (focus trap, Escape, focus restored) containing a drag-and-drop panel: per-file progress and cancel, list, download, confirmed delete; viewers can download but not upload. The upload client derives the content type from the extension, cleans up the pending row on failure, and has unit tests (48, including a guard that keeps its type map identical to the server allowlist). The production build passes. **Not yet exercised in a browser against real storage**; the UI interactions (drag/drop, dialog focus) have no automated tests.

### Phase E: Production Readiness & Observability
- [x] **Task E.1:** Structured JSON logging with request correlation across API and worker. `X-Request-Id` is honored when well-formed (hostile values replaced), returned to the caller and stamped on every log line; the API passes it to background jobs so the worker logs under the same id; authenticated lines carry `user_id`/`org_id` only; credentials are redacted; `LOG_LEVEL` is configurable; production worker logs never contain email addresses or bodies. Unit-tested, including the real Fastify wiring against a captured stream. Not yet run in a deployed environment; no log retention policy is defined.
- [x] **Task E.2:** Metrics and Grafana dashboards. New API metrics (DB latency and pool saturation, auth failures, WebSocket rejections/errors, Redis errors, finer latency buckets) and a worker metrics endpoint (job outcomes/durations, queue depth, queue lag, email results). Two dashboards ship in the Helm chart (`grafana.dashboards.enabled`), with a worker Service/ServiceMonitor and a NetworkPolicy rule for scraping; fixed the API ServiceMonitor, which scraped nothing when placed in another namespace. A test checks every dashboard query against the metrics the code registers. Chart verified with real `helm lint`/`helm template`; **not loaded into a live Grafana/Prometheus**. No alert rules yet. See `docs/observability.md`.
- [ ] **Task E.3:** Setup GitHub Actions CI workflow to run lint, build, test, Docker container scanning (`gitleaks`, `trivy`), and Helm lint on PRs.

---

## 5. Summary Matrix & Recommendation

| Component | Status | Next Milestone |
| :--- | :---: | :--- |
| **Foundation & Build** | 🟢 Complete | Maintain zero-warning baseline in CI |
| **API Backend & RBAC** | 🟢 Complete | Enforced server-side RBAC & tenant boundary test suite |
| **Background Worker** | 🟢 Functional | Worker unit tests added (Phase B); add job-retry/backoff coverage |
| **Frontend UI** | 🟢 Functional | Add attachment handling & granular role views (Phase D) |
| **Kubernetes & DevOps**| 🟢 Complete | Validate ArgoCD sync & Helm deployment rehearsal (Phase E) |

### Recommended Immediate Action:
Phase D is implemented, but none of it has run outside tests. Before starting **Phase E**, run the full stack once (real Postgres, Redis, two API instances and an S3/MinIO bucket) and walk through: live board updates across two browsers, an attachment upload/download/delete in the browser (this exercises the bucket CORS configuration), and `migrate`/`migrate:down`/`migrate` on a real database.

