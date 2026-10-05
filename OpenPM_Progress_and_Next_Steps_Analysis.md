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

### Phase B: Test Suite Expansion (Next Focus)
- [ ] **Task B.1:** Create integration test suites for Authentication flows (`register`, `login`, `password-reset`).
- [ ] **Task B.2:** Create task & project lifecycle integration tests (`apps/api/src/routes/tasks.test.ts`).
- [ ] **Task B.3:** Create worker process unit tests testing BullMQ payload consumption and Nodemailer dispatch mocks (`apps/worker`).

### Phase C: Database & Migration Framework Polish
- [ ] **Task C.1:** Standardize schema migrations with rollback support.
- [ ] **Task C.2:** Add indexes for foreign key lookups (`tasks(project_id)`, `projects(org_id)`, `organization_memberships(user_id, org_id)`).
- [ ] **Task C.3:** Add database transaction wrappers around multi-step operations (e.g., user registration creating default organization).

### Phase D: Multi-Node Scaling & Media Attachments
- [ ] **Task D.1:** Upgrade WebSocket handler with Redis Pub/Sub so task events broadcast across multi-instance API deployments.
- [ ] **Task D.2:** Implement file attachment upload service (`/api/tasks/:id/attachments`) using MinIO / AWS S3 client.
- [ ] **Task D.3:** Create frontend dropzone UI for task attachments.

### Phase E: Production Readiness & Observability
- [ ] **Task E.1:** Configure structured JSON logging with request correlation IDs across API and Worker.
- [ ] **Task E.2:** Add Grafana dashboard definitions in Helm chart for API performance, queue lag, and error rates.
- [ ] **Task E.3:** Setup GitHub Actions CI workflow to run lint, build, test, Docker container scanning (`gitleaks`, `trivy`), and Helm lint on PRs.

---

## 5. Summary Matrix & Recommendation

| Component | Status | Next Milestone |
| :--- | :---: | :--- |
| **Foundation & Build** | 🟢 Complete | Maintain zero-warning baseline in CI |
| **API Backend & RBAC** | 🟢 Complete | Enforced server-side RBAC & tenant boundary test suite |
| **Background Worker** | 🟢 Functional | Expand unit test coverage for job failures (Phase B) |
| **Frontend UI** | 🟢 Functional | Add attachment handling & granular role views (Phase D) |
| **Kubernetes & DevOps**| 🟢 Complete | Validate ArgoCD sync & Helm deployment rehearsal (Phase E) |

### Recommended Immediate Action:
Begin **Phase B** by creating comprehensive integration test suites for authentication and task lifecycle workflows.

