# OpenPM — Master Implementation & Production Readiness Roadmap

> Single source of truth for finishing OpenPM.
>
> **Goal:** Build OpenPM into a polished, secure, reliable, observable, self-hostable, Kubernetes-native project-management platform without sacrificing engineering quality for speed.
>
> **Last audited against the code:** 2026-11-15 (commit `c0c3cbc`). A box is ticked only when the code exists and is covered by tests or CI. Items marked *partial* exist but are incomplete. "Mocked DB" means the tests use a fake database, not a live Postgres. Nothing has been deployed to a cluster yet, so every deployment, restore and failure test is still open. The summary is in section 36.

---

## 0. Execution Rules

- Treat every checkbox as a verifiable engineering task.
- Do not mark a task complete because code merely exists; it must be implemented, integrated, tested, and documented.
- Work in small, reviewable issues/PRs.
- Follow existing project patterns before introducing abstractions.
- Do not add dependencies without a concrete reason.
- Do not modify unrelated files.
- Security-sensitive changes require explicit review.
- Infrastructure changes must be validated locally before deployment.
- Keep documentation synchronized with implementation.
- Never commit secrets, tokens, private keys, or production credentials.

### Definition of Done

A feature is **DONE** only when:

- [ ] Implementation is complete.
- [ ] Input validation exists.
- [ ] Authentication/authorization is enforced.
- [ ] Tenant isolation is verified.
- [ ] Error handling is deliberate.
- [ ] Relevant unit/integration tests pass.
- [ ] Edge cases are covered.
- [ ] Logs/metrics are appropriate.
- [ ] Documentation is updated where necessary.
- [ ] No security regression is introduced.
- [ ] CI passes.
- [ ] Lint/typecheck/format checks pass.

---

# 1. Repository Audit & Baseline

- [x] Inventory every app under `apps/`.
- [x] Inventory shared packages/modules.
- [x] Inventory all API routes.
- [x] Inventory all frontend routes/pages.
- [x] Inventory DB schema and migrations.
- [x] Inventory Redis usage.
- [x] Inventory BullMQ queues/workers.
- [x] Inventory WebSocket events.
- [x] Inventory Helm resources.
- [x] Inventory ArgoCD resources.
- [x] Inventory GitHub Actions.
- [x] Inventory tests.
- [x] Inventory Prometheus/Grafana configuration.
- [x] Inventory documentation.
- [x] Identify TODO/FIXME/temporary implementations.
- [x] Identify dead code and duplicated logic.
- [x] Identify undocumented behavior.

### Baseline

Run the project's actual scripts for:

```bash
npm install
npm run lint
npm run build
npm test
```

- [x] Establish a clean baseline.
- [x] Record existing failures.
- [x] Ensure a clean checkout can start locally.

---

# 2. Architecture & Code Quality

## Backend

- [ ] Separate routes, validation, business logic, persistence, and infrastructure. — *partial:* SQL and business logic still live in route handlers
- [ ] Keep route handlers thin.
- [x] Centralize authentication middleware. — `fastify.authenticate` (`plugins/auth.ts`), applied per route plugin
- [x] Centralize authorization. — `fastify.requireRole` (owner > admin > member > viewer)
- [ ] Centralize error handling. — *partial:* routes map ad-hoc thrown strings (`NOT_FOUND`, ...) to responses; no shared error handler
- [ ] Establish consistent API error responses. — *partial:* handlers return `{ error }`, but Fastify validation errors use a different shape
- [x] Add request/correlation IDs. — `X-Request-Id` in/out, propagated to worker jobs
- [x] Implement graceful shutdown. — API and worker handle SIGTERM/SIGINT
- [ ] Cleanly close DB/Redis/WebSocket connections. — *partial:* worker closes its pool; the API only calls `fastify.close()` and never ends the pg pool or Redis clients

## TypeScript

- [x] Use strict TypeScript settings where practical. — `strict` plus `noUncheckedIndexedAccess` etc. in `tsconfig.base.json`
- [ ] Remove unsafe `any` from important paths. — *partial:* route handlers still cast `request.body/params as any`
- [ ] Avoid duplicated domain types.
- [ ] Validate external input at runtime. — *partial:* JSON-schema validation on request bodies; path params (UUIDs) are not validated
- [ ] Validate environment variables at startup. — *partial:* API validates with zod (`config.ts`); the worker reads `process.env` directly

## Dependencies

- [ ] Remove unused dependencies.
- [x] Review dependency vulnerabilities. — npm audit cleared (Nov 2026 upgrades), Dependabot enabled
- [x] Keep dependency versions intentional. — Dependabot, Node 22 LTS, majors upgraded deliberately
- [ ] Avoid unnecessary packages.

---

# 3. Authentication

- [x] Verify JWT signatures correctly. — `@fastify/jwt`; invalid-token tests
- [x] Validate expiration. — 24h `expiresIn`; expired-token tests (HTTP and WebSocket)
- [ ] Validate issuer/audience where applicable.
- [x] Reject malformed tokens.
- [x] Reject missing authentication.
- [ ] Prevent JWT algorithm-confusion attacks.
- [x] Keep signing keys/secrets outside source code. — `JWT_SECRET` required in production; a dev-only fallback key remains in `config.ts`
- [x] Never log tokens. — credentials redacted in logs; tested
- [x] Define access-token lifetime. — 24h, httpOnly SameSite=strict cookie
- [ ] Define refresh-token strategy if applicable.
- [ ] Define token rotation/revocation.
- [x] Define logout behavior. — clears the cookie; the JWT itself stays valid until expiry (no revocation)
- [x] Rate-limit authentication endpoints. — login/register 10/min, forgot-password 5/min, reset-password 10/min, invite lookup/accept 20/10 per min
- [ ] Prevent account enumeration. — *partial:* login and forgot-password are uniform (forgot-password replies before doing any work, so timing is uniform too); register still returns "Email is already registered"
- [ ] Audit security-sensitive authentication events. — *partial:* password resets go to `activity_log`; login failures are only logged and counted (`auth_failures_total`)
- [x] Add authentication bypass tests. — `security_rbac.test.ts`, `websocket.test.ts`

---

# 4. Authorization, RBAC & Multi-Tenancy

OpenPM must never allow one organization to access another organization's data.

## Organization isolation

- [x] Derive organization identity from authenticated context.
- [x] Never trust client-supplied `org_id` as authority.
- [ ] Apply tenant filtering at the data-access layer. — *partial:* every query filters by the JWT `org_id`, but per query in route handlers, not in a shared layer
- [x] Verify ownership before read.
- [x] Verify ownership before update.
- [x] Verify ownership before delete.
- [x] Verify nested-resource ownership. — task -> project -> org, attachment -> task -> org
- [x] Verify WebSocket authorization. — JWT + Origin check; channel derived from the token
- [ ] Verify worker/job authorization context. — *partial:* jobs carry `org_id`, but the worker looks up tasks/users by id without an org filter

## RBAC

Define and document roles such as:

```text
Owner
Admin
Member
Viewer
```

- [ ] Document permissions.
- [x] Enforce permissions server-side.
- [x] Add UI restrictions only as a UX layer, never as the security boundary.
- [x] Add authorization tests. — `security_rbac.test.ts`
- [ ] Test privilege escalation. — *partial:* unknown keys (e.g. `role`) are rejected by the profile schema, but no test asserts it

## IDOR/BOLA testing

- [x] User A cannot read User B's project. — route tests with a mocked DB
- [x] User A cannot modify User B's project. — route tests with a mocked DB
- [x] User A cannot delete User B's task. — route tests with a mocked DB
- [x] User A cannot access another organization using guessed IDs. — route tests with a mocked DB
- [x] User A cannot join another organization's WebSocket channel.

---

# 5. Database & Prisma

## Schema

Review/finalize:

- [x] Users.
- [x] Organizations.
- [ ] Organization memberships. — *partial:* no membership table; each user has a single `users.org_id`
- [x] Projects.
- [ ] Project members.
- [x] Tasks/issues.
- [x] Status.
- [x] Priority.
- [ ] Labels/tags.
- [ ] Comments.
- [x] Attachments.
- [x] Activity/audit events. — `activity_log`
- [ ] Notifications.
- [x] Invitations.

## Integrity

- [x] Foreign keys.
- [x] Unique constraints.
- [x] Appropriate indexes. — migration 008
- [ ] Intentional cascade behavior.
- [ ] Consistent timestamps. — *partial:* `projects` and `organizations` have no `updated_at`
- [ ] Optimistic concurrency where needed.
- [x] Reproducible migrations. — numbered up/down SQL; `migrate`, `migrate:down`, `migrate:status`; run by Docker Compose

## Query quality

- [ ] Find N+1 queries.
- [ ] Add pagination to collections.
- [ ] Prevent unbounded queries.
- [ ] Select only required fields where useful.
- [x] Review transaction boundaries. — `withTransaction`
- [x] Use transactions for atomic multi-step writes.
- [ ] Profile slow queries.
- [x] Add indexes based on evidence. — derived from the routes' query patterns, not measured

## Database security

- [x] Credentials from secrets. — Helm Secrets
- [x] Database not publicly exposed. — ClusterIP + NetworkPolicy
- [ ] Least-privilege DB user.
- [ ] Automated backups in production.
- [ ] Restore procedure documented and tested.
- [ ] Migration/rollback strategy documented.

---

# 6. Organizations & Memberships

- [x] Create organization. — on registration
- [ ] Organization settings.
- [ ] Organization member list.
- [x] Invite member. — admin-only; the worker emails a link (`invite_created` job); token stored as a SHA-256 hash
- [x] Accept invitation. — public `POST /api/invites/lookup` + `/accept` and an `/invite` page; org, role and email come from the invite; verified on real Postgres via Compose
- [ ] Reject/expire invitation. — *partial:* invites expire after 7 days and can be revoked; no reject flow
- [ ] Remove member.
- [ ] Change member role.
- [ ] Transfer ownership.
- [ ] Leave organization.
- [ ] Delete organization with explicit confirmation.
- [ ] Audit membership changes.
- [ ] Test every operation against cross-tenant access.

---

# 7. Projects

- [x] Create project.
- [x] Edit project.
- [x] Archive project. — `status: archived` via PATCH
- [x] Restore project. — `status: active` via PATCH
- [x] Delete project. — also removes attachment files
- [ ] Project members.
- [ ] Project settings.
- [ ] Project activity. — *partial:* recorded in `activity_log`; no endpoint or UI exposes it
- [ ] Project statistics.
- [ ] Project-level authorization.
- [ ] Project empty states.
- [ ] Project loading/error states.

---

# 8. Tasks / Issues

Core fields:

- [x] Title.
- [x] Description.
- [x] Status.
- [x] Priority.
- [x] Assignee.
- [x] Creator/reporter.
- [ ] Labels.
- [x] Due date.
- [x] Created timestamp.
- [x] Updated timestamp.
- [x] Project association.

Actions:

- [x] Create task.
- [x] Edit task.
- [x] Delete task.
- [x] Assign task.
- [x] Change status.
- [x] Change priority.
- [ ] Add/remove labels.
- [x] Set/clear due date.
- [ ] Archive/restore if supported.
- [x] Audit important task actions. — `activity_log` for create/update/delete

---

# 9. Comments

- [ ] Create comment.
- [ ] Edit own comment.
- [ ] Delete own comment.
- [ ] Enforce comment ownership.
- [ ] Timestamp comments.
- [ ] Add mentions if supported.
- [ ] Generate comment activity events.
- [ ] Sanitize rich text/HTML if supported.

---

# 10. Search, Filtering & Pagination

- [ ] Search projects.
- [ ] Search tasks.
- [ ] Filter by status.
- [ ] Filter by priority.
- [ ] Filter by assignee.
- [ ] Filter by label.
- [ ] Filter by due date.
- [ ] Sort results.
- [ ] Paginate results.
- [ ] Limit maximum page size.
- [ ] Handle empty results.
- [ ] Test search performance.
- [ ] Prevent expensive/abusive query parameters.

---

# 11. Frontend Product Experience

## Navigation

- [ ] Consistent application shell.
- [ ] Organization switcher.
- [ ] Project navigation.
- [ ] User/account menu.
- [ ] Responsive navigation.
- [ ] Mobile behavior.
- [ ] Correct loading states.

## Dashboard

- [ ] Project overview.
- [ ] Assigned tasks.
- [ ] Recently updated tasks.
- [ ] Upcoming deadlines.
- [ ] Activity summary.
- [ ] Useful empty states.

## Task UI

- [x] Task creation.
- [ ] Task editing.
- [x] Status control. — drag and drop on the board
- [ ] Priority control.
- [ ] Assignee control.
- [ ] Labels.
- [ ] Due date.
- [ ] Description editor.
- [ ] Comments.
- [ ] Activity.
- [ ] Safe optimistic updates where appropriate.
- [ ] Error recovery.

## UX quality

- [ ] Loading skeletons.
- [ ] Error states.
- [ ] Empty states.
- [ ] Confirmation dialogs for destructive actions. — *partial:* attachment delete is confirmed; other deletes are not reviewed
- [ ] Toast/notification system.
- [ ] Keyboard accessibility.
- [x] Focus management. — task dialog: focus trap, Escape, focus restored
- [ ] Screen-reader labels.
- [ ] Responsive layouts.
- [ ] Consistent spacing and typography.
- [ ] No unnecessary loading spinners.
- [ ] No obvious placeholder UI.

---

# 12. Real-Time Collaboration

## WebSocket security

- [x] Authenticate WebSocket connections. — httpOnly cookie or Bearer header; never the query string
- [x] Reject unauthenticated clients.
- [x] Validate organization membership. — channel is derived from the JWT org
- [ ] Validate project membership before channel subscription. — *partial:* no project membership model; one org-wide channel
- [x] Prevent arbitrary channel subscription.

## Events

Document and validate events such as:

```text
task.created
task.updated
task.deleted
task.assigned
comment.created
comment.updated
comment.deleted
project.updated
member.added
member.removed
```

For every event:

- [ ] Payload schema.
- [ ] Authorization rules.
- [ ] Sender.
- [ ] Recipients.
- [ ] Retry/ordering behavior.
- [x] Tenant isolation. — per-org Redis channel

## Reliability

- [x] Reconnection. — exponential backoff with jitter
- [x] Heartbeat/ping-pong.
- [x] Stale connection cleanup. — missed heartbeat or JWT expiry closes the socket
- [ ] Connection limits.
- [ ] Backpressure strategy.
- [ ] Duplicate-event handling.
- [ ] Ordering strategy where needed.
- [ ] Multi-instance Redis/pub-sub testing. — *partial:* `RealtimeHub` design supports it; never run across two live pods

---

# 13. Redis

## Cache

- [x] Define cacheable data. — project list (5 min) and task board (60 s), org-scoped keys
- [x] Define TTLs.
- [x] Define invalidation. — deleted on every write
- [ ] Prevent stale authorization data.
- [x] Avoid unnecessary sensitive-data caching.
- [ ] Gracefully handle Redis outages. — *partial:* connection errors are logged and counted, but a failed cache read still fails the request

## Pub/Sub

- [ ] Document channels.
- [x] Prevent cross-tenant event leakage.
- [x] Handle reconnects. — ioredis auto-resubscribe
- [x] Handle subscriber failures. — socket closed with 1011; tested
- [ ] Test multiple API replicas. — *partial:* not run against live replicas

## Security

- [x] Redis authentication in production. — password in the Redis URL from a Secret
- [x] Redis network isolation. — NetworkPolicy
- [x] No public exposure.
- [x] Secrets managed securely. — Kubernetes Secrets
- [x] Memory limits. — container resources
- [ ] Intentional eviction policy.

---

# 14. BullMQ & Workers

For every queue:

- [ ] Define payload.
- [ ] Define retry policy. — *partial:* jobs are enqueued without `attempts`/`backoff`, so a failed email is not retried
- [ ] Define backoff.
- [ ] Define timeout.
- [ ] Define concurrency.
- [ ] Define idempotency.
- [ ] Define failure behavior.

Worker reliability:

- [x] Graceful shutdown.
- [ ] Retry handling.
- [x] Failed/dead-letter visibility. — failure logs and `jobs_total{status="failed"}`; BullMQ failed set
- [ ] Duplicate side-effect protection.
- [ ] Malformed-job handling. — *partial:* unknown job names are logged and skipped; payload fields are not validated
- [x] Job ID logging.
- [x] Processing-duration metrics.
- [x] Failure metrics.
- [ ] Restart behavior tests.

Operational controls:

- [x] Queue health metric. — queue lag + alerts
- [x] Queue depth metric.
- [x] Failed-job metric.
- [ ] Stuck-job recovery procedure.

---

# 15. Notifications

- [ ] Notification model.
- [ ] In-app notifications.
- [ ] Mark read.
- [ ] Mark all read.
- [ ] Notification preferences.
- [ ] Real-time delivery.
- [ ] Tenant isolation.
- [ ] Retention/cleanup policy.

Triggers:

- [ ] Assignment. — *partial:* email to the assignee when a task is created with one; not on reassignment, no in-app notification
- [ ] Mention.
- [ ] Comment.
- [ ] Status change.
- [ ] Due-date reminder.
- [ ] Organization invitation.
- [ ] Project membership change.

---

# 16. Audit Logging

Track important actions:

- [ ] Authentication/security events.
- [ ] Organization creation.
- [ ] Membership changes.
- [ ] Role changes.
- [ ] Project creation/deletion. — *partial:* creation is logged; project deletion is not
- [x] Task deletion.
- [ ] Permission changes.
- [x] Invitation actions. — created/revoked/accepted in `activity_log`
- [ ] Sensitive configuration changes.

Audit record:

```text
actor
organization
action
resource_type
resource_id
timestamp
request_id
metadata
```

- [x] Normal users cannot modify audit records. — no endpoint writes or edits `activity_log`
- [x] Tenant isolation enforced. — `org_id` on every row
- [x] Secrets never stored in metadata.
- [ ] Retention policy documented.
- [ ] Audit logs queryable.

---

# 17. API Design & Hardening

- [x] Consistent endpoint naming.
- [x] Consistent HTTP status codes.
- [ ] Consistent error structure.
- [ ] Consistent pagination.
- [ ] Consistent filtering.
- [ ] Consistent validation.
- [x] Consistent authorization.
- [ ] Validate path parameters.
- [ ] Validate query parameters.
- [x] Validate request bodies. — JSON schema, unknown keys rejected on PATCH
- [ ] Validate WebSocket payloads.
- [x] Request body size limits. — 1 MB
- [x] Rate limiting. — global 100/min, auth 10/min
- [x] Strict CORS. — single configured origin; tested
- [x] Security headers where appropriate. — `@fastify/helmet`
- [ ] Request timeouts.
- [ ] Safe error responses. — *partial:* unhandled 500s use Fastify's default handler, which returns the error message
- [ ] OpenAPI documentation. — *partial:* Swagger UI in non-production only; routes lack response schemas
- [ ] Authentication documentation.
- [ ] WebSocket event documentation.

---

# 18. Security Hardening

## Secrets

- [x] No secrets in Git. — gitleaks over full history in CI
- [x] No secrets in Docker images. — `.dockerignore`
- [x] No secrets in frontend bundles.
- [x] No secrets in logs.
- [x] `.env.example` contains placeholders only.
- [x] Production secrets use Kubernetes Secrets or an external secret manager.
- [ ] Rotation procedure documented.

## HTTP

- [x] HTTPS in production. — TLS ingress in `values.prod.yaml`, secure cookies; not deployed yet
- [x] Strict CORS.
- [x] Security headers.
- [x] Request limits.
- [x] Rate limits.
- [ ] Safe error responses.

## Input

- [ ] Validate all external input. — *partial:* bodies yes; path params no
- [x] Prevent injection. — parameterized SQL, whitelisted column names
- [ ] Sanitize rich text/HTML.
- [ ] Validate URLs where accepted.
- [x] Prevent path traversal. — random storage keys
- [x] Secure file uploads. — see section 19

## Tooling

- [ ] CodeQL passes.
- [x] Trivy passes or has documented exceptions. — report-only, documented in `docs/ci.md`
- [x] Secret scanning enabled.
- [x] Dependency scanning enabled. — Dependabot
- [x] Container scanning enabled. — Trivy
- [x] Security workflows run on PRs/releases. — on push and PR; first GitHub run not yet confirmed

---

# 19. File Uploads & Attachments

If attachments are supported:

- [x] File type allowlist.
- [x] File size limits.
- [x] Filename normalization.
- [x] Randomized storage names.
- [x] Authorization before download.
- [x] Authorization before deletion.
- [x] Content-type validation. — magic bytes checked on completion
- [ ] Malware scanning strategy.
- [x] Storage abstraction. — `storage/types.ts`
- [x] Prevent executable exposure. — allowlist + forced-download headers
- [x] Prevent path traversal.
- [ ] Retention policy.
- [ ] Orphan cleanup. — *partial:* files are deleted with their task/project; no reaper for abandoned pending uploads

---

# 20. Kubernetes

## Workloads

Review:

- [x] API Deployment.
- [x] Frontend Deployment.
- [x] Worker Deployment.
- [x] PostgreSQL strategy. — in-chart Deployment for dev, `externalDatabase` for prod
- [x] Redis strategy. — in-chart Deployment for dev, `externalRedis` for prod
- [x] Services.
- [x] Ingress.
- [x] ConfigMaps.
- [x] Secrets.

## Pod security

- [x] Non-root.
- [x] `allowPrivilegeEscalation: false`.
- [x] Read-only root filesystem where practical.
- [x] Drop unnecessary Linux capabilities.
- [x] Seccomp profile. — RuntimeDefault
- [x] Resource requests.
- [x] Resource limits.
- [x] Probes.

## Reliability

- [x] Liveness probes.
- [x] Readiness probes. — API and frontend
- [x] Startup probes where needed. — API
- [x] PodDisruptionBudget.
- [x] HorizontalPodAutoscaler.
- [x] Rolling strategy. — Deployment default
- [x] Graceful termination.
- [ ] Anti-affinity/topology rules where appropriate.

## Network

- [x] Default-deny NetworkPolicy where practical.
- [x] Explicit API-to-DB access.
- [x] Explicit API-to-Redis access.
- [x] Explicit worker-to-DB access.
- [x] Explicit worker-to-Redis access.
- [x] Restrict unnecessary east-west traffic.

## Helm

- [x] Validate templates. — `helm lint` + `helm template` for three value sets in CI
- [ ] Validate values.
- [x] Safe defaults.
- [ ] No hardcoded secrets. — *partial:* `values.yaml` ships dev default secrets meant to be overridden
- [x] Production values documented. — `values.prod.yaml`
- [ ] Install tested.
- [ ] Upgrade tested.
- [ ] Rollback tested.

---

# 21. ArgoCD / GitOps

- [x] Reproducible ArgoCD application. — app-of-apps
- [x] Environment separation. — dev/prod apps and namespaces
- [ ] Intentional sync policy. — *partial:* automated sync everywhere, and prod tracks `HEAD`
- [ ] Intentional prune policy.
- [ ] Intentional self-healing.
- [x] No plaintext production secrets in Git. — `values.prod.yaml` holds placeholders only
- [ ] Rollback procedure documented.
- [ ] Drift detection tested.
- [ ] Clean-cluster deployment tested.

---

# 22. Docker

- [x] Multi-stage builds.
- [x] Minimal production images. — node:22-alpine
- [x] Non-root runtime.
- [x] No dev dependencies in production image.
- [x] Complete `.dockerignore`.
- [ ] Deterministic builds where practical. — *partial:* runtime stage uses `npm install --omit=dev`, not `npm ci`
- [x] Vulnerability scanning. — Trivy in CI
- [ ] Image versioning/tag strategy.
- [x] Environment configuration outside images.
- [ ] Health checks. — *partial:* API and frontend; the worker image has none
- [x] Correct signal handling.
- [x] Graceful shutdown.

---

# 23. Observability

## Logging

- [x] Structured logs.
- [x] Request IDs.
- [x] Safe user/org context. — ids only
- [x] Appropriate stack traces.
- [x] No passwords/tokens/secrets.
- [x] Consistent log levels. — `LOG_LEVEL`
- [ ] Retention policy.

## Metrics

Track:

- [x] HTTP request count.
- [x] HTTP latency.
- [x] HTTP error rate. — from status labels
- [x] Active WebSocket connections.
- [x] WebSocket errors.
- [x] Database latency.
- [ ] Redis latency/errors. — *partial:* errors counted; latency not measured
- [x] Queue depth.
- [x] Worker duration.
- [x] Worker failures.
- [x] Authentication failures.
- [ ] Rate-limit events.

## Prometheus/Grafana

- [x] Prometheus scraping. — ServiceMonitors for API and worker
- [x] API dashboard.
- [x] Worker dashboard.
- [ ] Infrastructure dashboard.
- [ ] Redis/PostgreSQL dashboards where appropriate.
- [x] Alerts for critical failures. — 18 rules, promtool-tested

---

# 24. Testing

## Unit

- [x] Validation.
- [x] Business logic.
- [x] Authorization.
- [x] Permission checks.
- [x] Utilities.
- [x] Queue processors.

## Integration

- [ ] API + database. — *partial:* all route tests mock the database; nothing runs against real Postgres in CI
- [x] Authentication. — route-level, mocked DB
- [x] Tenant isolation. — route-level, mocked DB
- [x] RBAC. — route-level, mocked DB
- [x] Project CRUD. — route-level, mocked DB
- [x] Task CRUD. — route-level, mocked DB
- [ ] Comments.
- [ ] Notifications.
- [ ] Redis.
- [ ] Workers.

## Security

Explicitly test:

- [x] IDOR/BOLA.
- [x] Cross-tenant access.
- [ ] Privilege escalation.
- [x] Missing authentication.
- [x] Invalid JWT.
- [x] Expired JWT.
- [x] Unauthorized WebSocket subscription.
- [ ] Malicious payloads.
- [ ] Rate limiting.

## E2E

Critical flow:

```text
Login
  ↓
Create organization
  ↓
Invite member
  ↓
Create project
  ↓
Create task
  ↓
Assign task
  ↓
Comment
  ↓
Real-time update
  ↓
Notification
  ↓
Audit event
```

- [ ] Automate this flow. — *partial:* Playwright is set up with a single login spec
- [ ] Add failure-path tests.

## Load testing

- [ ] Authentication load.
- [ ] Task-list load.
- [ ] Task creation load.
- [ ] Concurrent WebSockets.
- [ ] Redis/pub-sub load.
- [ ] Worker throughput.
- [ ] Database performance.
- [ ] Establish performance baselines.

---

# 25. CI/CD

## Pull Request

- [x] Install. — `npm ci`
- [x] Lint.
- [x] Typecheck. — via `tsc`/`next build`
- [x] Unit tests.
- [ ] Integration tests.
- [x] Build.
- [ ] Dependency audit.
- [x] Secret scanning.
- [ ] CodeQL.
- [x] Container scan. — Trivy, report-only
- [x] Helm validation.

## Release

- [ ] Version/tag strategy.
- [ ] Immutable images.
- [ ] Push images.
- [ ] Release metadata.
- [ ] GitOps deployment.
- [ ] Deployment verification.
- [ ] Rollback.

## Branch protection

- [ ] CI required.
- [ ] Review required.
- [ ] Protected branches.
- [ ] Security checks required.
- [ ] Resolved review comments required.

---

# 26. Performance

## Backend

- [ ] Profile slow endpoints.
- [ ] Optimize DB queries.
- [x] Add evidence-based indexes.
- [x] Cache appropriate reads.
- [ ] Avoid unnecessary serialization.
- [ ] Request timeouts.

## Frontend

- [ ] Analyze bundle size.
- [ ] Lazy-load heavy components.
- [ ] Avoid unnecessary client components.
- [ ] Optimize data fetching.
- [ ] Prevent excessive re-renders.
- [ ] Optimize assets.

## Database

- [ ] Analyze slow queries.
- [ ] Use `EXPLAIN` where appropriate.
- [ ] Review indexes.
- [ ] Review connection pooling.
- [ ] Test under realistic load.

---

# 27. Reliability & Failure Handling

Test:

- [ ] PostgreSQL unavailable.
- [ ] Redis unavailable.
- [ ] Redis reconnect.
- [ ] Worker crash.
- [ ] API restart.
- [ ] WebSocket disconnect.
- [ ] DB connection exhaustion.
- [ ] Queue backlog.
- [ ] Invalid job.
- [ ] Partial deployment failure.
- [ ] Kubernetes pod restart.

Define:

- [ ] Retry behavior.
- [ ] Timeout behavior.
- [ ] Fallback behavior.
- [ ] User-visible failure behavior.
- [ ] Recovery procedures.

---

# 28. Backup, Recovery & Data Protection

- [ ] PostgreSQL backup strategy.
- [ ] Automated production backups.
- [ ] Backup retention.
- [ ] Restore test.
- [ ] Disaster-recovery procedure.
- [ ] Redis persistence strategy if needed.
- [ ] Attachment backup strategy if applicable.
- [ ] Data deletion policy.
- [ ] Organization deletion policy.

---

# 29. Privacy

- [ ] Document stored user data.
- [ ] Minimize unnecessary personal data.
- [x] Do not log sensitive data.
- [ ] Define retention periods.
- [ ] Define account deletion.
- [ ] Define organization deletion.
- [ ] Define export/deletion behavior if supported.

---

# 30. Threat Model

## Assets

- User accounts.
- Organization data.
- Projects.
- Tasks.
- Comments.
- Tokens.
- Database.
- Redis.
- Queue messages.
- Kubernetes secrets.
- Uploaded files.

## Threats

- [ ] Account takeover.
- [ ] JWT theft.
- [ ] IDOR/BOLA.
- [ ] Cross-tenant access.
- [ ] Privilege escalation.
- [ ] Malicious file upload.
- [ ] Injection.
- [ ] WebSocket abuse.
- [ ] Queue poisoning.
- [ ] Redis compromise.
- [ ] Database compromise.
- [ ] Secret leakage.
- [ ] Denial of service.
- [ ] Supply-chain compromise.

For every threat:

- [ ] Impact.
- [ ] Likelihood.
- [ ] Mitigation.
- [ ] Detection.
- [ ] Security test.

---

# 31. Documentation

## Developer

- [x] README.
- [x] Architecture.
- [x] Repository structure.
- [x] Local setup.
- [x] Environment variables.
- [ ] Database migrations. — *partial:* how to run them is documented; rollback is not
- [ ] Testing.
- [ ] API development.
- [ ] Worker development.
- [ ] WebSocket architecture.
- [ ] Redis architecture.

## Operations

- [x] Docker deployment.
- [x] Kubernetes deployment.
- [x] Helm configuration.
- [x] ArgoCD deployment.
- [ ] Secret management.
- [ ] Backup/restore.
- [ ] Rollback.
- [x] Monitoring. — `docs/observability.md`
- [ ] Incident response.

## Security

- [ ] Threat model.
- [ ] Security architecture.
- [ ] Authentication model.
- [ ] Authorization model.
- [ ] Tenant isolation model.
- [ ] Secret management.
- [x] Vulnerability reporting. — `SECURITY.md`
- [ ] Security assumptions.

---

# 32. Product Polish

Before release:

- [ ] Consistent design system.
- [ ] Consistent buttons/forms/modals.
- [ ] Consistent error messages.
- [ ] Consistent loading states.
- [ ] Consistent empty states.
- [ ] Keyboard navigation.
- [ ] Accessibility review.
- [ ] Responsive UI.
- [ ] Visual regression checks where useful.
- [ ] Clear onboarding.
- [ ] Helpful first-run experience.
- [ ] Destructive-action confirmations.
- [ ] Undo/recovery where appropriate.
- [ ] 404 page.
- [ ] 500/error page.
- [ ] Network failure states.
- [ ] No placeholder UI.
- [ ] No production console errors.

---

# 33. Release Gates

Do not call OpenPM production-ready until all critical gates pass.

## Gate 1 — Build

- [x] Install succeeds.
- [x] Lint succeeds.
- [x] Typecheck succeeds.
- [x] Build succeeds.

## Gate 2 — Tests

- [x] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Critical E2E path passes.
- [x] Security tests pass. — unit/route level

## Gate 3 — Security

- [ ] CodeQL passes.
- [x] Trivy passes or exceptions are documented.
- [x] Secret scanning passes.
- [x] No unresolved critical vulnerabilities. — npm audit clean after the Nov 2026 upgrades
- [ ] Tenant isolation verified.

## Gate 4 — Infrastructure

- [x] Docker builds.
- [x] Helm validates.
- [ ] Kubernetes deployment succeeds.
- [ ] Probes work.
- [ ] HPA works where applicable.
- [ ] NetworkPolicy works.
- [ ] PDB works.
- [ ] ArgoCD sync works.

## Gate 5 — Reliability

- [ ] DB failure recovery tested.
- [ ] Redis recovery tested.
- [ ] Worker restart tested.
- [ ] API restart tested.
- [ ] WebSocket reconnect tested.
- [ ] Backup restore tested.
- [ ] Rollback tested.

## Gate 6 — UX

- [ ] Core user journey works.
- [ ] No blocking UI defects.
- [ ] Responsive behavior verified.
- [ ] Accessibility reviewed.
- [ ] Error states reviewed.

---

# 34. Recommended Implementation Order

## Phase 1 — Foundation

- [x] Repository audit.
- [x] Baseline tests.
- [ ] Architecture cleanup.
- [x] Environment validation.
- [ ] Database schema finalization.
- [ ] Authentication hardening. — *partial:* no revocation, register leaks existing emails
- [x] Authorization foundation.
- [x] Tenant isolation.

## Phase 2 — Core Product

- [ ] Organizations.
- [ ] Memberships.
- [ ] Projects. — *partial:* CRUD/archive done; no project members or settings
- [ ] Tasks. — *partial:* everything except labels
- [ ] Comments.
- [ ] Labels.
- [ ] Search/filtering.
- [ ] Dashboard.

## Phase 3 — Collaboration

- [x] WebSockets.
- [x] Real-time task updates.
- [ ] Real-time comments.
- [ ] Notifications.
- [x] Redis pub/sub.
- [x] Reconnection handling.

## Phase 4 — Async Infrastructure

- [x] BullMQ.
- [x] Worker jobs.
- [ ] Retry policies.
- [ ] Failure handling.
- [x] Queue metrics.

## Phase 5 — Security

- [ ] Threat model.
- [x] Security tests.
- [x] Rate limiting.
- [ ] Input hardening.
- [x] File security.
- [ ] Audit logs.
- [ ] Secret management.

## Phase 6 — Kubernetes

- [x] Container hardening.
- [x] Helm hardening.
- [x] NetworkPolicies.
- [x] Pod security.
- [x] Probes.
- [x] HPA.
- [x] PDB.
- [x] Resource limits.

## Phase 7 — Observability

- [x] Structured logging.
- [x] Metrics.
- [x] Prometheus.
- [x] Grafana.
- [x] Alerts.
- [x] Correlation IDs.

## Phase 8 — CI/CD

- [x] PR pipeline.
- [x] Security scanning.
- [x] Container scanning.
- [ ] Release pipeline.
- [ ] GitOps deployment.
- [ ] Rollback.

## Phase 9 — Performance & Reliability

- [ ] Load tests.
- [ ] Database optimization.
- [ ] Redis optimization.
- [ ] WebSocket load.
- [ ] Worker throughput.
- [ ] Failure testing.

## Phase 10 — Product Polish

- [ ] UX audit.
- [ ] Accessibility.
- [ ] Responsive UI.
- [ ] Empty/error/loading states.
- [ ] Onboarding.
- [ ] Documentation.

## Phase 11 — Release

- [ ] Final security review.
- [ ] Final architecture review.
- [ ] Final test suite.
- [ ] Backup/restore test.
- [ ] Production deployment rehearsal.
- [ ] Release checklist.
- [ ] Version/tag.
- [ ] Release notes.

---

# 35. Agent Prompt Standard

Use this structure for every implementation task:

```text
CONTEXT:
Project: OpenPM
Relevant subsystem:
Relevant files:
Existing patterns to follow:

TASK:
Implement exactly [feature].

REQUIREMENTS:
- ...
- ...

SECURITY:
- Authentication:
- Authorization:
- Tenant isolation:
- Input validation:

TESTING:
- Unit:
- Integration:
- Security:
- Edge cases:

DONE WHEN:
- Implementation complete
- Tests pass
- Lint/typecheck pass
- Documentation updated

DO NOT:
- Touch unrelated modules
- Add dependencies without justification
- Change unrelated architecture
- Disable existing security controls
```

### Agent rules

- [ ] Give one scoped task at a time.
- [ ] Give actual file paths.
- [ ] Give existing schema/code context.
- [ ] Ask the agent to inspect existing patterns first.
- [ ] Require root-cause analysis before debugging.
- [ ] Require tests with feature work.
- [ ] Require security considerations for auth/data/infrastructure.
- [ ] Do not allow broad refactors during feature work unless explicitly requested.
- [ ] Review generated changes before merging.
- [ ] Run CI after each logical group.

---

# 36. Completion Tracking

Audited 2026-11-15 against commit `c0c3cbc`.

| Area                  | Status | Notes |
| --------------------- | ------ | ----- |
| Repository foundation | 🟢     | Install/lint/build/test clean on Node 22. Dependencies upgraded (Fastify 5, Next 16, React 19, Zod 4, Vitest 5, BullMQ 6) with npm audit clean. |
| Architecture          | 🟡     | Central auth/role checks, request IDs and graceful shutdown are in place. SQL and business logic still sit in route handlers, error handling is ad hoc, and the API never closes its pg pool or Redis clients on shutdown. |
| Authentication        | 🟡     | 24h JWT in an httpOnly cookie, production secret enforced, uniform login failures, bypass/expiry tests. Password reset works end to end (F.2): emailed single-use link, hashed tokens, 1h expiry, newest link only, rate-limited. Still missing: revocation/refresh (a reset does not end existing sessions), and register still reveals whether an email exists. |
| Authorization/RBAC    | 🟢     | `requireRole` (owner > admin > member > viewer) on every route, with authorization tests. Permissions are not yet documented. |
| Multi-tenancy         | 🟢     | Every query is scoped to the JWT `org_id`, with IDOR tests (mocked DB). Gaps: no shared data-access layer, and the worker does not filter by org. |
| Database              | 🟡     | 9 reversible migrations, FKs, indexes and transactions. No comments, labels, notifications, memberships or project-member tables. No pagination anywhere. No backups. |
| Organizations         | 🟡     | Create on register; invite by email, accept via link, revoke (F.1). No member list, role change, removal or org deletion. |
| Projects              | 🟡     | CRUD plus archive/restore (via `status`) with file cleanup. No project members, settings, activity view or stats. |
| Tasks                 | 🟡     | All core fields and actions, Kanban board, activity log. No labels, no archive. |
| Comments              | ⬜     | No table, routes or UI. |
| Search/filtering      | ⬜     | No search, filters or pagination. |
| Dashboard             | ⬜     | |
| WebSockets            | 🟢     | Cookie/Bearer auth, Origin check, per-org channel, heartbeat, JWT-expiry close, client backoff, metrics, all tested. Not yet run across two live pods. |
| Redis                 | 🟡     | Org-scoped cache with TTLs and invalidation; one shared subscriber per pod. A Redis outage still fails cached reads. No eviction policy. |
| BullMQ/Workers        | 🟡     | One job (`task_created` -> assignee email), logs carry job/request ids, metrics and alerts. **No retry/backoff** (`attempts` is not set) and no payload validation. |
| Notifications         | ⬜     | Only the assignment email on task creation. |
| Audit logging         | 🟡     | `activity_log` covers project/task create/update and task delete. Project delete, auth and membership events are not recorded, there is no `request_id` column, and no endpoint reads the log. |
| API hardening         | 🟡     | Body schemas, 1 MB limit, rate limits, helmet, strict CORS. Path params are not validated, there are no request timeouts, Swagger is dev-only, and 500 responses can echo error messages. |
| Security              | 🟡     | gitleaks, Trivy (report-only), Dependabot, no secrets in images or bundles. No CodeQL, no threat model, no rotation procedure. |
| File handling         | 🟢     | Allowlist, size limit, magic-byte check, random keys, org-scoped authorization, forced download (`docs/attachments.md`). Not covered: malware scanning, orphan reaper, retention. Not yet run against real S3/MinIO in a browser. |
| Docker                | 🟢     | Multi-stage, alpine, non-root, healthchecks (except worker), `.dockerignore`. Runtime stage uses `npm install`, not `npm ci`. No tag strategy. |
| Kubernetes            | 🟢     | Hardened pod security context, probes, HPA, PDB, default-deny NetworkPolicy with explicit egress (including HTTPS for email/S3). **Never deployed to a cluster.** |
| Helm                  | 🟡     | Lint and render checked in CI for three value sets. No `values.schema.json`; `values.yaml` ships dev secrets; install/upgrade/rollback never tested. |
| ArgoCD                | 🟡     | App-of-apps with dev/prod. Prod auto-syncs from `HEAD` with prune/self-heal. Never synced to a cluster. |
| Observability         | 🟢     | Structured logs, API/worker metrics, 2 Grafana dashboards, 18 promtool-tested alerts (`docs/observability.md`). Not loaded into a live Prometheus/Grafana; no log retention policy. |
| Testing               | 🟡     | Broad unit and route tests (mocked DB/Redis/S3). No tests against real Postgres, no E2E beyond one Playwright login spec, no load tests (the k6 script mentioned in the README does not exist). |
| CI/CD                 | 🟡     | PR/push pipeline: lint, build, test, Helm, gitleaks, image build + Trivy. No CodeQL, no integration tests, no release pipeline, no branch protection. First GitHub run not yet confirmed. |
| Performance           | ⬜     | Indexes and caching only; nothing measured. |
| Reliability           | ⬜     | No failure testing. |
| Backup/restore        | ⬜     | |
| Documentation         | 🟡     | README, CONTRIBUTING, SECURITY, plus attachments/CI/observability guides. Missing: permissions, WebSocket events, threat model, backup/rollback runbooks. |
| UX polish             | ⬜     | |
| Production readiness  | 🔴     | Blocked on a first live deployment; failed emails are not retried yet (F.3). |

### Status legend

- ⬜ Not started
- 🟡 In progress
- 🟢 Complete
- 🔴 Blocked
- ⚠️ Needs review

---

# 37. Final Quality Standard

OpenPM is not finished merely because every feature exists.

The target is:

```text
Correctness
    +
Security
    +
Reliability
    +
Maintainability
    +
Observability
    +
Testing
    +
User Experience
    +
Operational Readiness
        =
Production-ready OpenPM
```

> **Final principle:** Never optimize for the number of completed checkboxes. Optimize for a secure, reliable, testable, maintainable, observable, polished, self-hostable product that can be deployed confidently in Kubernetes.

**must remember, push every change to github**
