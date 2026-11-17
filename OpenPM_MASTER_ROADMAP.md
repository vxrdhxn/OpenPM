# OpenPM — Master Implementation & Production Readiness Roadmap

> Single source of truth for finishing OpenPM.
>
> **Goal:** Build OpenPM into a polished, secure, reliable, observable, self-hostable, Kubernetes-native project-management platform without sacrificing engineering quality for speed.
>
> **Last audited against the code:** 2026-11-17, after the v0.1.0 release (commit `d7fa018`). A box is ticked only when the code exists and is covered by tests or CI, or the procedure has been rehearsed. Items marked *partial* exist but are incomplete; "not applicable" items are ticked with the reason. Process checklists (Definition of Done, agent rules) and outlines (threat list) are plain bullets, not tasks. "Mocked DB" means the tests use a fake database, not a live Postgres. Deployment, upgrade, rollback, restore and failure tests have run on a local kind cluster and Compose, not on a cloud cluster. The summary is in section 36.

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

A checklist applied to every change (not tracked here). A feature is **DONE** only when:

- Implementation is complete.
- Input validation exists.
- Authentication/authorization is enforced.
- Tenant isolation is verified.
- Error handling is deliberate.
- Relevant unit/integration tests pass.
- Edge cases are covered.
- Logs/metrics are appropriate.
- Documentation is updated where necessary.
- No security regression is introduced.
- CI passes.
- Lint/typecheck/format checks pass.

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
- [x] Centralize error handling. — `plugins/errors.ts` (H.1); routes still map a few thrown strings (`NOT_FOUND`) locally
- [x] Establish consistent API error responses. — `{ error }` everywhere, including validation, 404 and 429
- [x] Add request/correlation IDs. — `X-Request-Id` in/out, propagated to worker jobs
- [x] Implement graceful shutdown. — API and worker handle SIGTERM/SIGINT
- [x] Cleanly close DB/Redis/WebSocket connections. — API: HTTP + WebSockets, then queue, Redis clients and pg pool, 25s deadline (`shutdown.ts`, H.1)

## TypeScript

- [x] Use strict TypeScript settings where practical. — `strict` plus `noUncheckedIndexedAccess` etc. in `tsconfig.base.json`
- [ ] Remove unsafe `any` from important paths. — *partial:* route handlers still cast `request.body/params as any`
- [ ] Avoid duplicated domain types.
- [ ] Validate external input at runtime. — *partial:* request bodies and path params (UUIDs) are validated; WebSocket payloads are not
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
- [x] Validate issuer/audience where applicable. — not applicable: the API is the only issuer and the only audience
- [x] Reject malformed tokens.
- [x] Reject missing authentication.
- [x] Prevent JWT algorithm-confusion attacks. — HMAC only (`@fastify/jwt` with a secret); unsigned, RS256 and HS512 tokens rejected (`auth.session.test.ts`)
- [x] Keep signing keys/secrets outside source code. — `JWT_SECRET` required in production; a dev-only fallback key remains in `config.ts`
- [x] Never log tokens. — credentials redacted in logs; tested
- [x] Define access-token lifetime. — 24h, httpOnly SameSite=strict cookie
- [x] Define refresh-token strategy if applicable. — not used: 24h tokens plus server-side revocation (H.3)
- [x] Define token rotation/revocation. — `users.token_version` (migration 012), checked on every request and WebSocket heartbeat; bumped by logout, password change and reset
- [x] Define logout behavior. — clears the cookie and ends all of the user's sessions on every device (H.3)
- [x] Rate-limit authentication endpoints. — login/register 10/min, forgot-password 5/min, reset-password 10/min, invite lookup/accept 20/10 per min
- [ ] Prevent account enumeration. — *partial:* login and forgot-password are uniform; register answers a taken email and a taken slug identically (H.3), but still fails where a fresh email would succeed. Fully closing it needs verify-by-email sign-up
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
- [x] Verify worker/job authorization context. — worker lookups are scoped to the job's `org_id` (reset jobs: user + token hash); tested

## RBAC

Define and document roles such as:

```text
Owner
Admin
Member
Viewer
```

- [ ] Document permissions. — *partial:* membership rules in `docs/members.md`; per-route permissions for projects/tasks not yet documented
- [x] Enforce permissions server-side.
- [x] Add UI restrictions only as a UX layer, never as the security boundary.
- [x] Add authorization tests. — `security_rbac.test.ts`
- [x] Test privilege escalation. — profile `role` change rejected, viewer/member write limits (real Postgres)

## IDOR/BOLA testing

- [x] User A cannot read User B's project. — route tests and real Postgres
- [x] User A cannot modify User B's project. — route tests and real Postgres
- [x] User A cannot delete User B's task. — route tests and real Postgres
- [x] User A cannot access another organization using guessed IDs. — route tests and real Postgres
- [x] User A cannot join another organization's WebSocket channel.

---

# 5. Database & Prisma

## Schema

Review/finalize:

- [x] Users.
- [x] Organizations.
- [ ] Organization memberships. — *partial:* one org per user (`users.org_id`); removal deactivates the row (`deactivated_at`, migration 013). No multi-org membership table
- [x] Projects.
- [ ] Project members.
- [x] Tasks/issues.
- [x] Status.
- [x] Priority.
- [x] Labels/tags. — `labels` + `task_labels` (migration 016)
- [x] Comments. — `task_comments` (migration 015)
- [x] Attachments.
- [x] Activity/audit events. — `activity_log`
- [x] Notifications. — `notifications` + `comment_mentions` (migration 018)
- [x] Invitations.

## Integrity

- [x] Foreign keys.
- [x] Unique constraints.
- [x] Appropriate indexes. — migration 008
- [ ] Intentional cascade behavior.
- [ ] Consistent timestamps. — *partial:* `projects` has no `updated_at` (`organizations` got one in migration 020)
- [ ] Optimistic concurrency where needed.
- [x] Reproducible migrations. — numbered up/down SQL; `migrate`, `migrate:down`, `migrate:status`; run by Docker Compose

## Query quality

- [ ] Find N+1 queries.
- [ ] Add pagination to collections. — *partial:* projects and task search; members, invites and attachments are bounded by org/task size, not paged
- [x] Prevent unbounded queries. — page size ≤ 100, board ≤ 1000 tasks
- [ ] Select only required fields where useful.
- [x] Review transaction boundaries. — `withTransaction`
- [x] Use transactions for atomic multi-step writes.
- [x] Profile slow queries. — `EXPLAIN ANALYZE` on 50,000 tasks (`docs/load-testing.md`)
- [x] Add indexes based on evidence. — derived from the routes' query patterns, not measured

## Database security

- [x] Credentials from secrets. — Helm Secrets
- [x] Database not publicly exposed. — ClusterIP + NetworkPolicy
- [ ] Least-privilege DB user.
- [ ] Automated backups in production. — *partial:* production expects a managed database with provider backups (`docs/backup-restore.md`); the in-chart Postgres has no backup job
- [x] Restore procedure documented and tested. — `docs/backup-restore.md`; drill and disaster recovery on Compose and kind (`docs/rehearsal.md`)
- [x] Migration/rollback strategy documented. — expand/contract, forward-only rollback (`docs/releasing.md`)

---

# 6. Organizations & Memberships

- [x] Create organization. — on registration; the creator is the owner (existing workspaces got one in migration 020)
- [x] Organization settings. — `GET`/`PATCH /api/organization` (rename; the slug is fixed), Workspace panel
- [x] Organization member list. — `GET /api/members` + Members panel
- [x] Invite member. — admin-only; the worker emails a link (`invite_created` job); token stored as a SHA-256 hash
- [x] Accept invitation. — public `POST /api/invites/lookup` + `/accept` and an `/invite` page; org, role and email come from the invite; verified on real Postgres via Compose
- [x] Reject/expire invitation. — expire after 7 days, revoke, and decline (`POST /api/invites/decline`; shown to admins as declined)
- [x] Remove member. — deactivates the account (sessions end, tasks unassigned, history kept, email freed)
- [x] Change member role. — must outrank the target, cannot grant above own role (`security/memberPolicy.ts`)
- [x] Transfer ownership. — `POST /api/members/:id/transfer-ownership`: atomic, audited; every organization keeps an owner
- [x] Leave organization. — refused for the last owner (and last admin); org row locked against races
- [x] Delete organization with explicit confirmation. — owner only, slug typed out plus password; cascades, then deletes files (`docs/members.md`)
- [x] Audit membership changes. — `role_changed`, `removed`, `left`, `ownership_transferred`; workspace `renamed`
- [x] Test every operation against cross-tenant access. — `members.int.test.ts`, `organization.int.test.ts` (real Postgres); browser test for rename and delete

---

# 7. Projects

- [x] Create project.
- [x] Edit project.
- [x] Archive project. — `status: archived` via PATCH
- [x] Restore project. — `status: active` via PATCH
- [x] Delete project. — also removes attachment files
- [ ] Project members.
- [ ] Project settings.
- [x] Project activity. — `GET /api/activity?project_id=`
- [x] Project statistics. — tasks by status per project (`GET /api/dashboard`)
- [ ] Project-level authorization.
- [x] Project empty states. — Phase 10
- [x] Project loading/error states. — Phase 10 (load errors with retry, "Project not found")

---

# 8. Tasks / Issues

Core fields:

- [x] Title.
- [x] Description.
- [x] Status.
- [x] Priority.
- [x] Assignee.
- [x] Creator/reporter.
- [x] Labels. — org-wide, palette colors (`docs/labels.md`)
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
- [x] Add/remove labels. — `PUT .../tasks/:taskId/labels`
- [x] Set/clear due date.
- [x] Archive/restore if supported. — not supported for tasks (projects can be archived)
- [x] Audit important task actions. — `activity_log` for create/update/delete

---

# 9. Comments

- [x] Create comment. — members and above; plain text, 1-10,000 characters (`docs/comments.md`)
- [x] Edit own comment. — author only; sets `edited_at`
- [x] Delete own comment. — author, or an admin as moderation
- [x] Enforce comment ownership. — server-side, scoped to task → project → org
- [x] Timestamp comments.
- [x] Add mentions if supported. — `@` autocomplete, `mention_ids` validated against active members
- [x] Generate comment activity events. — `activity_log` (no text) and live `comment_*` events
- [x] Sanitize rich text/HTML if supported. — n/a: plain text, rendered as text, never as HTML

---

# 10. Search, Filtering & Pagination

- [x] Search projects. — `GET /api/projects?q=` (name, literal wildcards); search box on the projects page
- [x] Search tasks. — `q` on `GET /api/tasks` and the board (title + description)
- [x] Filter by status. — projects (`active`/`archived`) and tasks
- [x] Filter by priority.
- [x] Filter by assignee. — `me`, `none` or a user id; board filter bar
- [x] Filter by label. — `label` on the board and `GET /api/tasks` (any of)
- [x] Filter by due date. — `due_after` / `due_before`
- [x] Sort results. — tasks: created, updated, due date (undated last), priority
- [x] Paginate results. — keyset cursors, `{ items, next_cursor }` (`docs/pagination.md`)
- [x] Limit maximum page size. — 100; board capped at 1000 tasks with `X-Truncated`
- [x] Handle empty results. — "No matching projects" state
- [x] Test search performance. — rare-term search 122 ms -> 0.5 ms with `pg_trgm` indexes (migration 019)
- [x] Prevent expensive/abusive query parameters. — bounded `limit`/`q`, validated cursors, unknown parameters rejected

---

# 11. Frontend Product Experience

## Navigation

- [x] Consistent application shell.
- [ ] Organization switcher.
- [ ] Project navigation.
- [ ] User/account menu. — *partial:* name, email, role and sign out in the sidebar; no menu
- [x] Responsive navigation.
- [x] Mobile behavior.
- [x] Correct loading states.

## Dashboard

- [x] Project overview. — KPI tiles and a per-project progress meter list (`docs/dashboard.md`)
- [x] Assigned tasks. — soonest deadline first
- [x] Recently updated tasks.
- [x] Upcoming deadlines. — next 14 days, org-wide
- [x] Activity summary. — `GET /api/activity` feed
- [x] Useful empty states. — per section, plus per-section loading and error states

## Task UI

- [x] Task creation.
- [x] Task editing. — task dialog edits every field
- [x] Status control. — drag and drop on the board
- [x] Priority control.
- [x] Assignee control.
- [x] Labels. — chips on cards, picker in the task dialog, Labels panel in settings
- [x] Due date.
- [x] Description editor. — plain text
- [x] Comments. — Comments section in the task dialog
- [ ] Activity.
- [ ] Safe optimistic updates where appropriate.
- [x] Error recovery. — failed saves keep the edit and say why; failed moves put the card back

## UX quality

- [x] Loading skeletons.
- [x] Error states.
- [x] Empty states.
- [x] Confirmation dialogs for destructive actions. — every delete, remove and leave
- [x] Toast/notification system. — `ui/feedback.tsx`
- [x] Keyboard accessibility.
- [x] Focus management. — task dialog: focus trap, Escape, focus restored
- [x] Screen-reader labels. — every control named (axe in CI)
- [x] Responsive layouts.
- [ ] Consistent spacing and typography.
- [ ] No unnecessary loading spinners.
- [x] No obvious placeholder UI.

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

For every event, document its payload schema, authorization rules, sender, recipients and retry/ordering behavior.

- [ ] Every event documented that way. — *partial:* comment and notification events in `docs/comments.md` and `docs/notifications.md`; task, project and member events are not
- [x] Tenant isolation. — per-org Redis channel

## Reliability

- [x] Reconnection. — exponential backoff with jitter
- [x] Heartbeat/ping-pong.
- [x] Stale connection cleanup. — missed heartbeat or JWT expiry closes the socket
- [ ] Connection limits. — *partial:* 1,000 concurrent sockets tested (8% CPU, 96 MB); no per-user or per-pod cap
- [ ] Backpressure strategy.
- [ ] Duplicate-event handling.
- [ ] Ordering strategy where needed.
- [x] Multi-instance Redis/pub-sub testing. — two API instances under Compose, both directions, in a browser (`docs/rehearsal.md`)

---

# 13. Redis

## Cache

- [x] Define cacheable data. — project list (5 min) and task board (60 s), org-scoped keys
- [x] Define TTLs.
- [x] Define invalidation. — deleted on every write
- [x] Prevent stale authorization data. — every request reads the role and token version from Postgres; roles are never cached
- [x] Avoid unnecessary sensitive-data caching.
- [x] Gracefully handle Redis outages. — cache ops fail fast and fall back to Postgres; missed invalidations retried on reconnect (H.2). Verified against a real Redis outage, job enqueueing included (Phase 9)

## Pub/Sub

- [ ] Document channels.
- [x] Prevent cross-tenant event leakage.
- [x] Handle reconnects. — ioredis auto-resubscribe
- [x] Handle subscriber failures. — socket closed with 1011; tested
- [x] Test multiple API replicas. — Compose rehearsal with `docker-compose.scale.yml`

## Security

- [x] Redis authentication in production. — password in the Redis URL from a Secret
- [x] Redis network isolation. — NetworkPolicy
- [x] No public exposure.
- [x] Secrets managed securely. — Kubernetes Secrets
- [x] Memory limits. — container resources
- [ ] Intentional eviction policy. — *partial:* Redis runs with its default (no memory limit, `noeviction`), which BullMQ needs, but it is not set explicitly

---

# 14. BullMQ & Workers

For every queue:

- [x] Define payload. — `docs/jobs.md`; validated in the worker (`lib/jobs.ts`)
- [x] Define retry policy. — 5 attempts (`DEFAULT_JOB_OPTIONS` in `apps/api/src/queue.ts`)
- [x] Define backoff. — exponential from 30s (30s, 1m, 2m, 4m)
- [x] Define timeout. — 15s per email provider call
- [x] Define concurrency. — 5 per worker (`WORKER_CONCURRENCY`)
- [x] Define idempotency. — email idempotency key per job (`openpm/<name>/<id>/<timestamp>`); jobs re-check staleness before sending
- [x] Define failure behavior. — retryable vs `UnrecoverableError` table in `docs/jobs.md`

Worker reliability:

- [x] Graceful shutdown.
- [x] Retry handling. — verified live: Postgres cut off, attempt 1 failed, attempt 2 succeeded 30s later
- [x] Failed/dead-letter visibility. — failure logs and `jobs_total{status="failed"}`; BullMQ failed set
- [x] Duplicate side-effect protection. — provider idempotency key, stable across retries
- [x] Malformed-job handling. — fails once with `UnrecoverableError` (verified live); unknown job names fail retryably so an updated worker can run them
- [x] Job ID logging.
- [x] Processing-duration metrics.
- [x] Failure metrics.
- [x] Restart behavior tests. — worker killed mid-queue: 3,000/3,000 jobs, stalled jobs re-run

Operational controls:

- [x] Queue health metric. — queue lag + alerts
- [x] Queue depth metric.
- [x] Failed-job metric.
- [x] Stuck-job recovery procedure. — `docs/jobs.md` (retrying the failed set, stalled jobs)

---

# 15. Notifications

- [x] Notification model. — one row per recipient, written in the triggering transaction (`docs/notifications.md`)
- [x] In-app notifications. — sidebar badge and `/notifications`
- [x] Mark read.
- [x] Mark all read.
- [ ] Notification preferences.
- [x] Real-time delivery. — content-free `notification` event; clients fetch their own
- [x] Tenant isolation. — recipients filtered to active org members in the INSERT; reads scoped to the caller
- [ ] Retention/cleanup policy. — kept until the task is deleted

Triggers:

- [x] Assignment. — in-app on create and reassignment (plus the email on create)
- [x] Mention.
- [x] Comment. — to the task's assignee and creator
- [x] Status change. — to the task's assignee and creator
- [ ] Due-date reminder.
- [ ] Organization invitation.
- [ ] Project membership change.

---

# 16. Audit Logging

Track important actions:

- [ ] Authentication/security events.
- [ ] Organization creation.
- [x] Membership changes.
- [x] Role changes.
- [x] Project creation/deletion. — deletion logged with the name
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
- [ ] Audit logs queryable. — *partial:* product activity via `GET /api/activity`; no admin view of account/membership events

---

# 17. API Design & Hardening

- [x] Consistent endpoint naming.
- [x] Consistent HTTP status codes.
- [x] Consistent error structure. — `{ error }` (H.1)
- [x] Consistent pagination. — one helper for every paged endpoint
- [x] Consistent filtering. — shared task filters for the board and search
- [ ] Consistent validation.
- [x] Consistent authorization.
- [x] Validate path parameters. — every `:id`/`:*Id` must be a UUID (`plugins/uuidParams.ts`)
- [x] Validate query parameters. — JSON schema, unknown keys rejected
- [x] Validate request bodies. — JSON schema, unknown keys rejected on PATCH
- [ ] Validate WebSocket payloads.
- [x] Request body size limits. — 1 MB
- [x] Rate limiting. — global 100/min, auth 10/min
- [x] Strict CORS. — single configured origin; tested
- [x] Security headers where appropriate. — `@fastify/helmet`
- [x] Request timeouts. — 30s `requestTimeout`, 10s Postgres `statement_timeout`
- [x] Safe error responses. — 5xx bodies are generic; details only in the log
- [ ] OpenAPI documentation. — *partial:* Swagger UI in non-production only; routes lack response schemas
- [ ] Authentication documentation.
- [ ] WebSocket event documentation. — *partial:* comment events in `docs/comments.md`; task events not yet documented

---

# 18. Security Hardening

## Secrets

- [x] No secrets in Git. — gitleaks over full history in CI
- [x] No secrets in Docker images. — `.dockerignore`
- [x] No secrets in frontend bundles.
- [x] No secrets in logs.
- [x] `.env.example` contains placeholders only.
- [x] Production secrets use Kubernetes Secrets or an external secret manager.
- [x] Rotation procedure documented. — `docs/deploying.md` (JWT secret, Postgres and Redis passwords); rehearsed on `openpm-dev`

## HTTP

- [x] HTTPS in production. — TLS ingress in `values.prod.yaml`, secure cookies; not deployed yet
- [x] Strict CORS.
- [x] Security headers.
- [x] Request limits.
- [x] Rate limits.
- [x] Safe error responses.

## Input

- [ ] Validate all external input. — *partial:* bodies and path params yes; WebSocket payloads no
- [x] Prevent injection. — parameterized SQL, whitelisted column names
- [x] Sanitize rich text/HTML. — not applicable: descriptions and comments are plain text, rendered escaped by React; no `dangerouslySetInnerHTML`
- [x] Validate URLs where accepted. — not applicable: no endpoint accepts a URL
- [x] Prevent path traversal. — random storage keys
- [x] Secure file uploads. — see section 19

## Tooling

- [x] CodeQL passes. — javascript-typescript + actions, `security-extended`, green on GitHub (H.4); findings are not yet merge-blocking
- [x] Trivy passes or has documented exceptions. — blocking on HIGH/CRITICAL (fixable) since G.1
- [x] Secret scanning enabled.
- [x] Dependency scanning enabled. — Dependabot
- [x] Container scanning enabled. — Trivy
- [x] Security workflows run on PRs/releases. — on push and PR; green on GitHub since 2026-11-15

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
- [ ] Validate values. — *partial:* credentials are checked at render time and `tests/helm/rendered.test.ts` checks the objects; no `values.schema.json`
- [x] Safe defaults.
- [x] No hardcoded secrets. — no default credentials; rendering fails without them; `secrets.existingSecret` (Phase 11)
- [x] Production values documented. — `values.prod.yaml`
- [x] Install tested. — kind, default values (`docs/rehearsal.md`)
- [x] Upgrade tested. — kind; config-only changes roll pods
- [x] Rollback tested. — kind; rollback from a broken image tag, data intact

---

# 21. ArgoCD / GitOps

- [x] Reproducible ArgoCD application. — app-of-apps
- [x] Environment separation. — dev/prod apps and namespaces
- [x] Intentional sync policy. — dev automated; prod manual (G.5)
- [x] Intentional prune policy. — dev prunes; prod prunes only on a manual sync
- [x] Intentional self-healing. — dev only; drift reverted in ~2 s on kind
- [x] No plaintext production secrets in Git. — `values.prod.yaml` holds placeholders only
- [x] Rollback procedure documented. — `docs/releasing.md`
- [x] Drift detection tested. — kind (G.5)
- [x] Clean-cluster deployment tested. — new kind cluster (G.4), Argo CD on it (G.5), production values in a fresh namespace (Phase 11)

---

# 22. Docker

- [x] Multi-stage builds.
- [x] Minimal production images. — node:22-alpine
- [x] Non-root runtime.
- [x] No dev dependencies in production image.
- [x] Complete `.dockerignore`.
- [x] Deterministic builds where practical. — `npm ci` in every stage (G.1)
- [x] Vulnerability scanning. — Trivy in CI
- [x] Image versioning/tag strategy. — `X.Y.Z` plus `sha-<commit>`, never overwritten, production pinned by digest (`docs/releasing.md`)
- [x] Environment configuration outside images.
- [ ] Health checks. — *partial:* API and frontend images; the worker has a Kubernetes liveness probe and a Compose check, but no image `HEALTHCHECK`
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
- [ ] Rate-limit events. — *partial:* 429s are counted in `http_requests_total` by route; no dedicated metric or alert

## Prometheus/Grafana

- [x] Prometheus scraping. — ServiceMonitors for API and worker; verified live with Compose (`docker-compose.monitoring.yml`)
- [x] API dashboard.
- [x] Worker dashboard.
- [ ] Infrastructure dashboard.
- [ ] Redis/PostgreSQL dashboards where appropriate.
- [x] Alerts for critical failures. — 18 rules, promtool-tested; `OpenPMWorkerDown` fired and cleared in a live rehearsal

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

- [x] API + database. — `apps/api/src/test/integration` against real Postgres, in CI (G.2)
- [x] Authentication. — route-level and against real Postgres
- [x] Tenant isolation. — real Postgres: every cross-org read/write/delete returns 404 and leaves the row unchanged
- [x] RBAC. — route-level and against real Postgres
- [x] Project CRUD. — route-level and against real Postgres
- [x] Task CRUD. — route-level and against real Postgres
- [x] Comments. — `comments.int.test.ts` (real Postgres)
- [x] Notifications. — `notifications.int.test.ts` (real Postgres)
- [ ] Redis. — *partial:* shared rate limits run against a real Redis (`rateLimitShared.int.test.ts`); cache and pub/sub are faked
- [ ] Workers.

## Security

Explicitly test:

- [x] IDOR/BOLA.
- [x] Cross-tenant access.
- [x] Privilege escalation.
- [x] Missing authentication.
- [x] Invalid JWT.
- [x] Expired JWT.
- [x] Unauthorized WebSocket subscription.
- [ ] Malicious payloads.
- [x] Rate limiting. — login 10/min and forgot-password 5/min against the real app wiring

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

- [x] Automate this flow. — `journey.spec.ts` in CI (Phase 10)
- [ ] Add failure-path tests. — *partial:* unsaved edits, unknown project and page; no browser tests of API errors

## Load testing

- [x] Authentication load. — 2 logins/s alongside the mix; found and fixed bcrypt starving the libuv pool (`docs/load-testing.md`)
- [x] Task-list load. — boards, task search, dashboard, activity (`load/k6/api.js`)
- [x] Task creation load. — writes at 5-10/s; 2,000 creates at 175/s for the worker test
- [x] Concurrent WebSockets. — 1,000 sockets, every event delivered, p95 80 ms
- [x] Redis/pub-sub load. — 70,000 events fanned out through Redis to 1,000 sockets
- [x] Worker throughput. — 2,000 jobs in 13.8 s (no email provider)
- [x] Database performance. — 50,000 tasks seeded; slow queries fixed (migration 019)
- [x] Establish performance baselines. — one API process: 0 errors, reads p95 97 ms at 40 req/s; knee 40-60 req/s on a shared 4-vCPU box

---

# 25. CI/CD

## Pull Request

- [x] Install. — `npm ci`
- [x] Lint.
- [x] Typecheck. — via `tsc`/`next build`
- [x] Unit tests.
- [x] Integration tests. — Postgres service container
- [x] Build.
- [ ] Dependency audit. — *partial:* Dependabot, Trivy (blocking), `npm audit` clean; no `npm audit` gate on PRs
- [x] Secret scanning.
- [x] CodeQL. — `codeql.yml` (H.4)
- [x] Container scan. — Trivy, blocking
- [x] Helm validation.

## Release

- [x] Version/tag strategy. — one semver for the repo, `vX.Y.Z` tags, checked in CI (`docs/releasing.md`)
- [x] Immutable images. — prod pinned by digest; a released version is never re-pushed
- [x] Push images. — GHCR, after a blocking Trivy scan, with SBOM and provenance
- [x] Release metadata. — GitHub Release with notes and digests; OCI labels
- [x] GitOps deployment. — release PR → merge → manual `openpm-prod` sync
- [x] Deployment verification. — PostSync smoke-test Job
- [x] Rollback. — revert + sync; rehearsed on kind

## Branch protection

- [ ] CI required. — *pending:* settings documented in `docs/ci.md`; must be enabled in GitHub repo settings
- [ ] Review required.
- [ ] Protected branches.
- [ ] Security checks required.
- [ ] Resolved review comments required.

---

# 26. Performance

## Backend

- [x] Profile slow endpoints. — per-endpoint isolation (`load/k6/endpoint.js`): the board was the outlier
- [x] Optimize DB queries. — board per column, search trigrams, dashboard progress
- [x] Add evidence-based indexes.
- [x] Cache appropriate reads.
- [ ] Avoid unnecessary serialization. — *partial:* boards bounded to 400 tasks; cached responses are still parsed and re-serialized
- [x] Request timeouts.

## Frontend

- [ ] Analyze bundle size.
- [ ] Lazy-load heavy components.
- [ ] Avoid unnecessary client components.
- [ ] Optimize data fetching.
- [ ] Prevent excessive re-renders.
- [ ] Optimize assets.

## Database

- [x] Analyze slow queries.
- [x] Use `EXPLAIN` where appropriate.
- [ ] Review indexes.
- [x] Review connection pooling. — exhaustion answered 503; 2 min idle timeout; bcrypt kept off the pool's DNS threads
- [x] Test under realistic load. — Compose, single machine (a real cluster is G.5)

---

# 27. Reliability & Failure Handling

Test:

- [x] PostgreSQL unavailable. — 503 + Retry-After, API and sockets stay up, recovers by itself (it used to crash)
- [x] Redis unavailable. — reads served from Postgres, `/health` degraded, task creation succeeds (it used to hang)
- [x] Redis reconnect. — cache, pub/sub and queue resume without a restart
- [x] Worker crash. — `docker kill` mid-queue; nothing lost
- [x] API restart. — about 2 s unavailable; sockets closed with 1001 and reconnected
- [x] WebSocket disconnect. — clients reconnect after a restart (backoff)
- [x] DB connection exhaustion. — 503 + Retry-After, `overload_rejections_total`, alert `OpenPMApiOverloaded`
- [x] Queue backlog. — 3,000 queued jobs drained after a worker restart
- [x] Invalid job. — malformed payload fails without retries (live test)
- [ ] Partial deployment failure.
- [ ] Kubernetes pod restart.

Define:

- [x] Retry behavior. — background jobs: `docs/jobs.md`
- [x] Timeout behavior. — request 30 s, statement 10 s, pool 2 s (503), enqueue 2 s, cache 250 ms
- [x] Fallback behavior. — cache -> Postgres; failed enqueue -> request still succeeds, counted
- [x] User-visible failure behavior. — load errors with retry, failed saves as toasts, offline banner (Phase 10)
- [ ] Recovery procedures. — *partial:* restore (`docs/backup-restore.md`), rollback (`docs/releasing.md`), observed recovery (`docs/load-testing.md`); no incident runbook

---

# 28. Backup, Recovery & Data Protection

- [x] PostgreSQL backup strategy. — `docs/backup-restore.md`
- [ ] Automated production backups. — *partial:* managed-database backups expected; no job for the in-chart Postgres
- [ ] Backup retention.
- [x] Restore test. — `scripts/test-backup-restore.sh`, run on Compose and kind
- [x] Disaster-recovery procedure. — restore over the live database, rehearsed on kind
- [x] Redis persistence strategy if needed. — not backed up by design: cache and queue refill; jobs queued at the moment of loss are lost (documented)
- [x] Attachment backup strategy if applicable. — bucket versioning/replication (`docs/backup-restore.md`)
- [ ] Data deletion policy.
- [x] Organization deletion policy. — immediate and complete, owner-confirmed; recoverable only from a backup (`docs/members.md`)

---

# 29. Privacy

- [ ] Document stored user data.
- [ ] Minimize unnecessary personal data.
- [x] Do not log sensitive data.
- [ ] Define retention periods.
- [ ] Define account deletion.
- [x] Define organization deletion. — `docs/members.md`
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

- [ ] Threat model written. — *not started:* `docs/security-review.md` (v0.1.0) checks the main controls but is not a threat model. Outline:

Threats:

- Account takeover.
- JWT theft.
- IDOR/BOLA.
- Cross-tenant access.
- Privilege escalation.
- Malicious file upload.
- Injection.
- WebSocket abuse.
- Queue poisoning.
- Redis compromise.
- Database compromise.
- Secret leakage.
- Denial of service.
- Supply-chain compromise.

For every threat: impact, likelihood, mitigation, detection and a security test.

---

# 31. Documentation

## Developer

- [x] README.
- [x] Architecture.
- [x] Repository structure.
- [x] Local setup.
- [x] Environment variables.
- [x] Database migrations. — running them (README, CONTRIBUTING), rollback and compatibility (`docs/releasing.md`)
- [x] Testing. — CONTRIBUTING, `docs/frontend-testing.md`, `docs/ci.md`
- [ ] API development.
- [ ] Worker development. — *partial:* `docs/jobs.md` covers jobs, retries and recovery
- [ ] WebSocket architecture.
- [ ] Redis architecture.

## Operations

- [x] Docker deployment.
- [x] Kubernetes deployment.
- [x] Helm configuration.
- [x] ArgoCD deployment.
- [x] Secret management. — `docs/deploying.md`
- [x] Backup/restore. — `docs/backup-restore.md`
- [x] Rollback. — `docs/releasing.md`
- [x] Monitoring. — `docs/observability.md`
- [ ] Incident response.

## Security

- [ ] Threat model.
- [ ] Security architecture.
- [ ] Authentication model. — *partial:* summarized in `docs/security-review.md`
- [ ] Authorization model. — *partial:* roles in `docs/user-guide.md`, membership rules in `docs/members.md`
- [ ] Tenant isolation model. — *partial:* summarized in `docs/security-review.md`
- [x] Secret management. — `docs/deploying.md`
- [x] Vulnerability reporting. — `SECURITY.md`
- [ ] Security assumptions. — *partial:* known limits in `docs/security-review.md`

---

# 32. Product Polish

Before release:

- [ ] Consistent design system. — *partial:* shared Dialog, Field, button, toast and state components (`components/ui`); older pages still carry one-off styles
- [x] Consistent buttons/forms/modals. — every dialog uses `ui/Dialog`; `btn-compact` / `btn-secondary` / `btn-danger`
- [x] Consistent error messages. — toasts for actions, `ErrorBlock` with retry for loads
- [ ] Consistent loading states. — *partial:* shared `LoadingBlock`; the dashboard keeps its own skeletons
- [x] Consistent empty states. — `EmptyBlock` with the action that fills it
- [x] Keyboard navigation. — dialogs, skip link, menu, keyboard drag (tested; `docs/accessibility.md`)
- [ ] Accessibility review. — *partial:* axe WCAG 2.1 AA clean on every screen in CI, keyboard reviewed; no screen-reader pass yet
- [x] Responsive UI. — phone menu drawer, no sideways scrolling, tested at Pixel 7 size
- [ ] Visual regression checks where useful.
- [x] Clear onboarding. — dashboard welcome with three steps; `docs/user-guide.md`
- [x] Helpful first-run experience. — "Create your first project" opens the project dialog
- [x] Destructive-action confirmations. — in-app confirm (Cancel focused) for every delete, remove and leave
- [ ] Undo/recovery where appropriate. — *partial:* unsaved task edits are protected; archive instead of delete for projects; no undo after delete
- [x] 404 page.
- [x] 500/error page. — `error.tsx` and `global-error.tsx`
- [x] Network failure states. — offline banner; failed requests shown, not swallowed
- [x] No placeholder UI. — the board's "Loading..." title and the empty app shell are gone
- [ ] No production console errors. — *partial:* no app errors in dev; production build not checked in a browser

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
- [x] Integration tests pass.
- [x] Critical E2E path passes. — Browser tests (Playwright) job in CI
- [x] Security tests pass. — unit/route level

## Gate 3 — Security

- [x] CodeQL passes. — analysis runs green; open alerts not yet reviewed (Security → Code scanning)
- [x] Trivy passes or exceptions are documented.
- [x] Secret scanning passes.
- [x] No unresolved critical vulnerabilities. — npm audit clean after the Nov 2026 upgrades
- [x] Tenant isolation verified. — against real Postgres in CI; not yet on a deployed cluster

## Gate 4 — Infrastructure

- [x] Docker builds.
- [x] Helm validates.
- [x] Kubernetes deployment succeeds. — kind (G.4); not yet a real cluster
- [x] Probes work. — API not ready until the database works; observed on kind
- [x] HPA works where applicable. — kind + metrics-server: 2 → 7 under load, back to 2 after (G.5)
- [x] NetworkPolicy works. — enforced on kind: required paths open, others blocked
- [ ] PDB works. — *partial:* PDBs report the right allowed disruptions; no drain test
- [x] ArgoCD sync works. — kind: sync, drift reverted by self-heal (G.5)

## Gate 5 — Reliability

- [x] DB failure recovery tested. — Compose (Phase 9)
- [x] Redis recovery tested. — Compose (Phase 9)
- [x] Worker restart tested. — killed mid-queue, nothing lost
- [x] API restart tested. — sockets 1001 + reconnect
- [x] WebSocket reconnect tested.
- [x] Backup restore tested. — Phase 11
- [x] Rollback tested. — `helm rollback` on kind

## Gate 6 — UX

- [x] Core user journey works. — `journey.spec.ts` in CI
- [x] No blocking UI defects. — none known after the Phase 10 audit
- [x] Responsive behavior verified. — `responsive.spec.ts` (phone)
- [ ] Accessibility reviewed. — *partial:* automated + keyboard; screen reader pending
- [x] Error states reviewed.

---

# 34. Recommended Implementation Order

## Phase 1 — Foundation

- [x] Repository audit.
- [x] Baseline tests.
- [ ] Architecture cleanup.
- [x] Environment validation.
- [ ] Database schema finalization.
- [x] Authentication hardening. — revocation via token_version, current role on every request, uniform register conflicts (H.3)
- [x] Authorization foundation.
- [x] Tenant isolation.

## Phase 2 — Core Product

- [x] Organizations. — owners, settings, transfer, deletion, declinable invites
- [x] Memberships. — list, role change, remove, leave, ownership transfer
- [ ] Projects. — *partial:* CRUD/archive done; no project members or settings
- [x] Tasks. — every field, including labels (no archive)
- [x] Comments.
- [x] Labels.
- [x] Search/filtering. — projects and tasks; label filter waits for labels
- [x] Dashboard.

## Phase 3 — Collaboration

- [x] WebSockets.
- [x] Real-time task updates.
- [x] Real-time comments. — `comment_created/updated/deleted` on the org channel
- [x] Notifications.
- [x] Redis pub/sub.
- [x] Reconnection handling.

## Phase 4 — Async Infrastructure

- [x] BullMQ.
- [x] Worker jobs.
- [x] Retry policies.
- [x] Failure handling.
- [x] Queue metrics.

## Phase 5 — Security

- [ ] Threat model.
- [x] Security tests.
- [x] Rate limiting.
- [ ] Input hardening.
- [x] File security.
- [ ] Audit logs.
- [x] Secret management. — no default credentials, `existingSecret`, rotation documented

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
- [x] Release pipeline. — `release.yml` on `vX.Y.Z` tags (not yet run: first tag pending)
- [x] GitOps deployment. — release PR pins prod digests; manual sync; smoke test (rehearsed on kind)
- [x] Rollback. — revert the deploy PR + sync; rehearsed on kind across a migration (`docs/releasing.md`)

## Phase 9 — Performance & Reliability

- [x] Load tests.
- [x] Database optimization.
- [x] Redis optimization. — pub/sub fan-out to 1,000 sockets at 8% CPU; nothing to optimize yet
- [x] WebSocket load.
- [x] Worker throughput.
- [x] Failure testing.

## Phase 10 — Product Polish

- [x] UX audit. — findings fixed in Phase 10 (task editing, labels, nested controls, contrast, layout)
- [x] Accessibility. — WCAG 2.1 AA automated in CI; screen-reader pass still open
- [x] Responsive UI.
- [x] Empty/error/loading states.
- [x] Onboarding.
- [x] Documentation. — `docs/user-guide.md`, `docs/accessibility.md`, `docs/frontend-testing.md`

## Phase 11 — Release

- [x] Final security review. — `docs/security-review.md`: 7 findings fixed (published default credentials in the chart and Compose, DB ports exposed, rate limits shared behind the Ingress and counted per pod, no framing headers, unencoded passwords)
- [x] Final architecture review. — per-pod rate-limit state moved to Redis; credentials moved out of chart values (`existingSecret`); README architecture corrected (Next.js 16, per-request session checks)
- [x] Final test suite. — 2026-11-17, locally: unit 649 (API 427, worker 113, frontend 109), repo 81, integration 126 (with a real Redis), browser 16 passed / 3 skipped
- [x] Backup/restore test. — `scripts/backup-db.sh`, `restore-db.sh`, `test-backup-restore.sh`; drill on Compose and Kubernetes plus a disaster recovery (`docs/backup-restore.md`, `docs/rehearsal.md`)
- [x] Production deployment rehearsal. — `values.prod.yaml` with an existing Secret on kind: install, smoke test, Ingress, rate limits, restore (`docs/rehearsal.md`)
- [x] Release checklist. — `docs/release-checklist.md`
- [x] Version/tag. — `v0.1.0` tagged 2026-11-17: images on GHCR and a GitHub Release; its deploy PR has to be opened by hand (Actions may not create PRs yet)
- [x] Release notes. — `docs/release-notes/v0.1.0.md` (the release workflow puts it on the GitHub Release)

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

How to brief an agent (guidance, not tracked here):

- Give one scoped task at a time.
- Give actual file paths.
- Give existing schema/code context.
- Ask the agent to inspect existing patterns first.
- Require root-cause analysis before debugging.
- Require tests with feature work.
- Require security considerations for auth/data/infrastructure.
- Do not allow broad refactors during feature work unless explicitly requested.
- Review generated changes before merging.
- Run CI after each logical group.

---

# 36. Completion Tracking

Audited 2026-11-17 against commit `d7fa018` (v0.1.0 is `4290599`).

| Area                  | Status | Notes |
| --------------------- | ------ | ----- |
| Repository foundation | 🟢     | Install/lint/build/test clean on Node 22. Dependencies current (Fastify 5, Next 16, React 19, Zod 4, Vitest 5, BullMQ 6); `npm audit` clean. |
| Architecture          | 🟡     | Central auth/role checks, request IDs, a shared error handler, graceful shutdown; rate-limit state in Redis, shared by every pod. SQL and business logic still sit in route handlers; `as any` casts on request bodies; the worker reads `process.env` without validation. |
| Authentication        | 🟡     | 24h JWT in an httpOnly cookie; secrets required, published ones refused in production; algorithm confusion tested. Password reset end to end; sessions revocable everywhere (WebSockets included); the current role is read on every request. Remaining: changing the password does not ask for the current one; sign-up can reveal a taken email until it verifies by email; no MFA or lockout. |
| Authorization/RBAC    | 🟢     | `requireRole` (owner > admin > member > viewer) on every route, with authorization tests. Roles in `docs/user-guide.md`; per-route permissions not documented. |
| Multi-tenancy         | 🟢     | Every query scoped to the session's `org_id` (directly or after an org-scoped ownership check, reviewed in Phase 11); IDOR tests against real Postgres in CI. Gap: no shared data-access layer. |
| Database              | 🟡     | 20 reversible migrations, FKs, indexes, transactions; backup/restore scripts and a tested drill. No project-member tables; `projects` has no `updated_at`; no least-privilege DB user. |
| Organizations         | 🟢     | The creator owns the workspace and every workspace keeps an owner; rename, ownership transfer, and deletion (slug + password, full cascade including files); invite, accept, decline, revoke; member list, role change, remove and leave with rank rules and an audit trail. No reactivation of removed members (re-invite) or multi-workspace membership. |
| Projects              | 🟡     | Create, edit, archive/restore and delete from the UI, with file cleanup. No project members, settings or project-level permissions. |
| Tasks                 | 🟢     | Every field editable in one dialog; labels, comments with @mentions, attachments, Kanban board with filters (labels included), keyboard moves, org-wide search, activity log. No task archive. |
| Comments              | 🟢     | Post, edit, delete, mentions with notifications, pagination, live events, plain-text rendering (`docs/comments.md`). |
| Search/filtering      | 🟢     | Keyset pagination on projects and task search; status, priority, assignee, label and due filters; measured on 50,000 tasks (`docs/load-testing.md`). |
| Dashboard             | 🟢     | KPI tiles, my tasks, deadlines, recently updated, project progress, activity, and a first-run welcome; each section loads on its own. Covered by the browser tests. |
| WebSockets            | 🟢     | Cookie/Bearer auth, Origin check, per-org channel, heartbeat, expiry close, backoff; verified across two API instances and on kind through an Ingress. Payloads are not schema-validated; no per-user connection cap. |
| Redis                 | 🟢     | Org-scoped cache, shared subscriber per pod, shared rate-limit counters; outage tested (reads from Postgres, writes succeed, rate limiting fails open). Eviction policy is the default, not set explicitly. |
| BullMQ/Workers        | 🟢     | Three email jobs with retries, idempotent sends, payload validation, metrics and alerts (`docs/jobs.md`); retry verified through a Postgres outage. |
| Notifications         | 🟢     | In-app: assignment, mention, comment, status change; live badge; mark read. No due-date reminders, preferences or retention policy. |
| Audit logging         | 🟡     | `activity_log` covers projects, tasks, comments, labels, invites, membership and password resets; readable via `GET /api/activity`. Login events are not recorded; no admin view of account events. |
| API hardening         | 🟡     | Body schemas, UUID params, 1 MB limit, rate limits per real client (`TRUST_PROXY`) shared across pods, helmet, strict CORS, one error shape, timeouts. Swagger is dev-only; routes lack response schemas. |
| Security              | 🟡     | Pre-release review with 7 fixes (`docs/security-review.md`): no default credentials anywhere, published secrets refused, framing headers. gitleaks, Trivy (blocking), CodeQL, Dependabot. No threat model, no full CSP. |
| File handling         | 🟢     | Allowlist, size limit, magic-byte check, random keys, org-scoped authorization, forced download; verified against MinIO. Not covered: malware scanning, pending-upload reaper, retention. |
| Docker                | 🟢     | Multi-stage, alpine, non-root, Trivy-clean; tag strategy `X.Y.Z` + `sha-<commit>`. Compose requires `JWT_SECRET` and keeps Postgres/Redis on localhost. The worker image has no `HEALTHCHECK` (Kubernetes probes it). |
| Kubernetes            | 🟢     | Installed and exercised on kind: app flow, NetworkPolicies, upgrades, rollback, Argo CD, Ingress, HPA, a production-values install from an existing Secret, restore. Not tested: a cloud cluster, node drain (PDB), topology spread. |
| Helm                  | 🟢     | No default credentials (render fails without them), `existingSecret`, digest pinning, smoke test hook; CI renders and checks three value sets. No `values.schema.json`. |
| ArgoCD                | 🟢     | App-of-apps; dev auto-syncs with self-heal, prod syncs by hand; both read credentials from `openpm-secrets`. Dev upgraded off the old default credentials on kind. Prod not yet synced. |
| Observability         | 🟢     | Structured logs, API/worker metrics, 2 dashboards, 18 tested alerts, run against live Prometheus/Grafana. No log retention policy, Redis latency metric or infrastructure dashboards. |
| Testing               | 🟢     | Unit (649), repo (Helm, release scripts), integration against real Postgres and Redis (126), browser tests in CI (journey, keyboard, axe WCAG 2.1 AA, phone, headers). Cache and pub/sub faked in integration; no browser tests of API failures; load tests not in CI. |
| CI/CD                 | 🟡     | 10 checks green; release workflow published v0.1.0 (images with SBOM and provenance, GitHub Release). Branch protection not enabled; Actions may not open the deploy PR yet; no `npm audit` gate. |
| Performance           | 🟡     | Measured on Compose with 50,000 tasks and 1,000 WebSockets (`docs/load-testing.md`); HPA scaling on kind. Not measured on a real cluster; no soak test; no frontend bundle review. |
| Reliability           | 🟢     | Failure-tested in Compose (Postgres, Redis, worker, API restarts, pool exhaustion); rollback and restore rehearsed on kind. No incident runbook; not tested on a cloud cluster. |
| Backup/restore        | 🟢     | Scripts, a drill that compares every table, and a disaster recovery rehearsed (`docs/backup-restore.md`). No scheduled job for the in-chart Postgres; no retention policy. |
| Documentation         | 🟢     | README, CONTRIBUTING, SECURITY, user guide, deploying, releasing, backup/restore, release checklist, security review, accessibility, testing and feature docs. Missing: threat model, per-route permissions, task/project WebSocket events, incident runbook, privacy/data policy. |
| UX polish             | 🟢     | Phase 10: task and project editing, shared dialogs, toasts, error and empty states, phone layout, onboarding, WCAG 2.1 AA in CI. Open: screen-reader pass, account menu, undo, visual regression checks. |
| Production readiness  | 🟡     | v0.1.0 released. To run it: merge the deploy PR, create `openpm-secrets` in `openpm-prod`, sync. Never run on a cloud cluster. |

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
