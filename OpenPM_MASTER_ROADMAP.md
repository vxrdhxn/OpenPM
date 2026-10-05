# OpenPM — Master Implementation & Production Readiness Roadmap

> Single source of truth for finishing OpenPM.
>
> **Goal:** Build OpenPM into a polished, secure, reliable, observable, self-hostable, Kubernetes-native project-management platform without sacrificing engineering quality for speed.

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

- [ ] Separate routes, validation, business logic, persistence, and infrastructure.
- [ ] Keep route handlers thin.
- [ ] Centralize authentication middleware.
- [ ] Centralize authorization.
- [ ] Centralize error handling.
- [ ] Establish consistent API error responses.
- [ ] Add request/correlation IDs.
- [ ] Implement graceful shutdown.
- [ ] Cleanly close DB/Redis/WebSocket connections.

## TypeScript

- [ ] Use strict TypeScript settings where practical.
- [ ] Remove unsafe `any` from important paths.
- [ ] Avoid duplicated domain types.
- [ ] Validate external input at runtime.
- [ ] Validate environment variables at startup.

## Dependencies

- [ ] Remove unused dependencies.
- [ ] Review dependency vulnerabilities.
- [ ] Keep dependency versions intentional.
- [ ] Avoid unnecessary packages.

---

# 3. Authentication

- [ ] Verify JWT signatures correctly.
- [ ] Validate expiration.
- [ ] Validate issuer/audience where applicable.
- [ ] Reject malformed tokens.
- [ ] Reject missing authentication.
- [ ] Prevent JWT algorithm-confusion attacks.
- [ ] Keep signing keys/secrets outside source code.
- [ ] Never log tokens.
- [ ] Define access-token lifetime.
- [ ] Define refresh-token strategy if applicable.
- [ ] Define token rotation/revocation.
- [ ] Define logout behavior.
- [ ] Rate-limit authentication endpoints.
- [ ] Prevent account enumeration.
- [ ] Audit security-sensitive authentication events.
- [ ] Add authentication bypass tests.

---

# 4. Authorization, RBAC & Multi-Tenancy

OpenPM must never allow one organization to access another organization's data.

## Organization isolation

- [ ] Derive organization identity from authenticated context.
- [ ] Never trust client-supplied `org_id` as authority.
- [ ] Apply tenant filtering at the data-access layer.
- [ ] Verify ownership before read.
- [ ] Verify ownership before update.
- [ ] Verify ownership before delete.
- [ ] Verify nested-resource ownership.
- [ ] Verify WebSocket authorization.
- [ ] Verify worker/job authorization context.

## RBAC

Define and document roles such as:

```text
Owner
Admin
Member
Viewer
```

- [ ] Document permissions.
- [ ] Enforce permissions server-side.
- [ ] Add UI restrictions only as a UX layer, never as the security boundary.
- [ ] Add authorization tests.
- [ ] Test privilege escalation.

## IDOR/BOLA testing

- [ ] User A cannot read User B's project.
- [ ] User A cannot modify User B's project.
- [ ] User A cannot delete User B's task.
- [ ] User A cannot access another organization using guessed IDs.
- [ ] User A cannot join another organization's WebSocket channel.

---

# 5. Database & Prisma

## Schema

Review/finalize:

- [ ] Users.
- [ ] Organizations.
- [ ] Organization memberships.
- [ ] Projects.
- [ ] Project members.
- [ ] Tasks/issues.
- [ ] Status.
- [ ] Priority.
- [ ] Labels/tags.
- [ ] Comments.
- [ ] Attachments.
- [ ] Activity/audit events.
- [ ] Notifications.
- [ ] Invitations.

## Integrity

- [ ] Foreign keys.
- [ ] Unique constraints.
- [ ] Appropriate indexes.
- [ ] Intentional cascade behavior.
- [ ] Consistent timestamps.
- [ ] Optimistic concurrency where needed.
- [ ] Reproducible migrations.

## Query quality

- [ ] Find N+1 queries.
- [ ] Add pagination to collections.
- [ ] Prevent unbounded queries.
- [ ] Select only required fields where useful.
- [ ] Review transaction boundaries.
- [ ] Use transactions for atomic multi-step writes.
- [ ] Profile slow queries.
- [ ] Add indexes based on evidence.

## Database security

- [ ] Credentials from secrets.
- [ ] Database not publicly exposed.
- [ ] Least-privilege DB user.
- [ ] Automated backups in production.
- [ ] Restore procedure documented and tested.
- [ ] Migration/rollback strategy documented.

---

# 6. Organizations & Memberships

- [ ] Create organization.
- [ ] Organization settings.
- [ ] Organization member list.
- [ ] Invite member.
- [ ] Accept invitation.
- [ ] Reject/expire invitation.
- [ ] Remove member.
- [ ] Change member role.
- [ ] Transfer ownership.
- [ ] Leave organization.
- [ ] Delete organization with explicit confirmation.
- [ ] Audit membership changes.
- [ ] Test every operation against cross-tenant access.

---

# 7. Projects

- [ ] Create project.
- [ ] Edit project.
- [ ] Archive project.
- [ ] Restore project.
- [ ] Delete project.
- [ ] Project members.
- [ ] Project settings.
- [ ] Project activity.
- [ ] Project statistics.
- [ ] Project-level authorization.
- [ ] Project empty states.
- [ ] Project loading/error states.

---

# 8. Tasks / Issues

Core fields:

- [ ] Title.
- [ ] Description.
- [ ] Status.
- [ ] Priority.
- [ ] Assignee.
- [ ] Creator/reporter.
- [ ] Labels.
- [ ] Due date.
- [ ] Created timestamp.
- [ ] Updated timestamp.
- [ ] Project association.

Actions:

- [ ] Create task.
- [ ] Edit task.
- [ ] Delete task.
- [ ] Assign task.
- [ ] Change status.
- [ ] Change priority.
- [ ] Add/remove labels.
- [ ] Set/clear due date.
- [ ] Archive/restore if supported.
- [ ] Audit important task actions.

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

- [ ] Task creation.
- [ ] Task editing.
- [ ] Status control.
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
- [ ] Confirmation dialogs for destructive actions.
- [ ] Toast/notification system.
- [ ] Keyboard accessibility.
- [ ] Focus management.
- [ ] Screen-reader labels.
- [ ] Responsive layouts.
- [ ] Consistent spacing and typography.
- [ ] No unnecessary loading spinners.
- [ ] No obvious placeholder UI.

---

# 12. Real-Time Collaboration

## WebSocket security

- [ ] Authenticate WebSocket connections.
- [ ] Reject unauthenticated clients.
- [ ] Validate organization membership.
- [ ] Validate project membership before channel subscription.
- [ ] Prevent arbitrary channel subscription.

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
- [ ] Tenant isolation.

## Reliability

- [ ] Reconnection.
- [ ] Heartbeat/ping-pong.
- [ ] Stale connection cleanup.
- [ ] Connection limits.
- [ ] Backpressure strategy.
- [ ] Duplicate-event handling.
- [ ] Ordering strategy where needed.
- [ ] Multi-instance Redis/pub-sub testing.

---

# 13. Redis

## Cache

- [ ] Define cacheable data.
- [ ] Define TTLs.
- [ ] Define invalidation.
- [ ] Prevent stale authorization data.
- [ ] Avoid unnecessary sensitive-data caching.
- [ ] Gracefully handle Redis outages.

## Pub/Sub

- [ ] Document channels.
- [ ] Prevent cross-tenant event leakage.
- [ ] Handle reconnects.
- [ ] Handle subscriber failures.
- [ ] Test multiple API replicas.

## Security

- [ ] Redis authentication in production.
- [ ] Redis network isolation.
- [ ] No public exposure.
- [ ] Secrets managed securely.
- [ ] Memory limits.
- [ ] Intentional eviction policy.

---

# 14. BullMQ & Workers

For every queue:

- [ ] Define payload.
- [ ] Define retry policy.
- [ ] Define backoff.
- [ ] Define timeout.
- [ ] Define concurrency.
- [ ] Define idempotency.
- [ ] Define failure behavior.

Worker reliability:

- [ ] Graceful shutdown.
- [ ] Retry handling.
- [ ] Failed/dead-letter visibility.
- [ ] Duplicate side-effect protection.
- [ ] Malformed-job handling.
- [ ] Job ID logging.
- [ ] Processing-duration metrics.
- [ ] Failure metrics.
- [ ] Restart behavior tests.

Operational controls:

- [ ] Queue health metric.
- [ ] Queue depth metric.
- [ ] Failed-job metric.
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

- [ ] Assignment.
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
- [ ] Project creation/deletion.
- [ ] Task deletion.
- [ ] Permission changes.
- [ ] Invitation actions.
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

- [ ] Normal users cannot modify audit records.
- [ ] Tenant isolation enforced.
- [ ] Secrets never stored in metadata.
- [ ] Retention policy documented.
- [ ] Audit logs queryable.

---

# 17. API Design & Hardening

- [ ] Consistent endpoint naming.
- [ ] Consistent HTTP status codes.
- [ ] Consistent error structure.
- [ ] Consistent pagination.
- [ ] Consistent filtering.
- [ ] Consistent validation.
- [ ] Consistent authorization.
- [ ] Validate path parameters.
- [ ] Validate query parameters.
- [ ] Validate request bodies.
- [ ] Validate WebSocket payloads.
- [ ] Request body size limits.
- [ ] Rate limiting.
- [ ] Strict CORS.
- [ ] Security headers where appropriate.
- [ ] Request timeouts.
- [ ] Safe error responses.
- [ ] OpenAPI documentation.
- [ ] Authentication documentation.
- [ ] WebSocket event documentation.

---

# 18. Security Hardening

## Secrets

- [ ] No secrets in Git.
- [ ] No secrets in Docker images.
- [ ] No secrets in frontend bundles.
- [ ] No secrets in logs.
- [ ] `.env.example` contains placeholders only.
- [ ] Production secrets use Kubernetes Secrets or an external secret manager.
- [ ] Rotation procedure documented.

## HTTP

- [ ] HTTPS in production.
- [ ] Strict CORS.
- [ ] Security headers.
- [ ] Request limits.
- [ ] Rate limits.
- [ ] Safe error responses.

## Input

- [ ] Validate all external input.
- [ ] Prevent injection.
- [ ] Sanitize rich text/HTML.
- [ ] Validate URLs where accepted.
- [ ] Prevent path traversal.
- [ ] Secure file uploads.

## Tooling

- [ ] CodeQL passes.
- [ ] Trivy passes or has documented exceptions.
- [ ] Secret scanning enabled.
- [ ] Dependency scanning enabled.
- [ ] Container scanning enabled.
- [ ] Security workflows run on PRs/releases.

---

# 19. File Uploads & Attachments

If attachments are supported:

- [ ] File type allowlist.
- [ ] File size limits.
- [ ] Filename normalization.
- [ ] Randomized storage names.
- [ ] Authorization before download.
- [ ] Authorization before deletion.
- [ ] Content-type validation.
- [ ] Malware scanning strategy.
- [ ] Storage abstraction.
- [ ] Prevent executable exposure.
- [ ] Prevent path traversal.
- [ ] Retention policy.
- [ ] Orphan cleanup.

---

# 20. Kubernetes

## Workloads

Review:

- [ ] API Deployment.
- [ ] Frontend Deployment.
- [ ] Worker Deployment.
- [ ] PostgreSQL strategy.
- [ ] Redis strategy.
- [ ] Services.
- [ ] Ingress.
- [ ] ConfigMaps.
- [ ] Secrets.

## Pod security

- [ ] Non-root.
- [ ] `allowPrivilegeEscalation: false`.
- [ ] Read-only root filesystem where practical.
- [ ] Drop unnecessary Linux capabilities.
- [ ] Seccomp profile.
- [ ] Resource requests.
- [ ] Resource limits.
- [ ] Probes.

## Reliability

- [ ] Liveness probes.
- [ ] Readiness probes.
- [ ] Startup probes where needed.
- [ ] PodDisruptionBudget.
- [ ] HorizontalPodAutoscaler.
- [ ] Rolling strategy.
- [ ] Graceful termination.
- [ ] Anti-affinity/topology rules where appropriate.

## Network

- [ ] Default-deny NetworkPolicy where practical.
- [ ] Explicit API-to-DB access.
- [ ] Explicit API-to-Redis access.
- [ ] Explicit worker-to-DB access.
- [ ] Explicit worker-to-Redis access.
- [ ] Restrict unnecessary east-west traffic.

## Helm

- [ ] Validate templates.
- [ ] Validate values.
- [ ] Safe defaults.
- [ ] No hardcoded secrets.
- [ ] Production values documented.
- [ ] Install tested.
- [ ] Upgrade tested.
- [ ] Rollback tested.

---

# 21. ArgoCD / GitOps

- [ ] Reproducible ArgoCD application.
- [ ] Environment separation.
- [ ] Intentional sync policy.
- [ ] Intentional prune policy.
- [ ] Intentional self-healing.
- [ ] No plaintext production secrets in Git.
- [ ] Rollback procedure documented.
- [ ] Drift detection tested.
- [ ] Clean-cluster deployment tested.

---

# 22. Docker

- [ ] Multi-stage builds.
- [ ] Minimal production images.
- [ ] Non-root runtime.
- [ ] No dev dependencies in production image.
- [ ] Complete `.dockerignore`.
- [ ] Deterministic builds where practical.
- [ ] Vulnerability scanning.
- [ ] Image versioning/tag strategy.
- [ ] Environment configuration outside images.
- [ ] Health checks.
- [ ] Correct signal handling.
- [ ] Graceful shutdown.

---

# 23. Observability

## Logging

- [ ] Structured logs.
- [ ] Request IDs.
- [ ] Safe user/org context.
- [ ] Appropriate stack traces.
- [ ] No passwords/tokens/secrets.
- [ ] Consistent log levels.
- [ ] Retention policy.

## Metrics

Track:

- [ ] HTTP request count.
- [ ] HTTP latency.
- [ ] HTTP error rate.
- [ ] Active WebSocket connections.
- [ ] WebSocket errors.
- [ ] Database latency.
- [ ] Redis latency/errors.
- [ ] Queue depth.
- [ ] Worker duration.
- [ ] Worker failures.
- [ ] Authentication failures.
- [ ] Rate-limit events.

## Prometheus/Grafana

- [ ] Prometheus scraping.
- [ ] API dashboard.
- [ ] Worker dashboard.
- [ ] Infrastructure dashboard.
- [ ] Redis/PostgreSQL dashboards where appropriate.
- [ ] Alerts for critical failures.

---

# 24. Testing

## Unit

- [ ] Validation.
- [ ] Business logic.
- [ ] Authorization.
- [ ] Permission checks.
- [ ] Utilities.
- [ ] Queue processors.

## Integration

- [ ] API + database.
- [ ] Authentication.
- [ ] Tenant isolation.
- [ ] RBAC.
- [ ] Project CRUD.
- [ ] Task CRUD.
- [ ] Comments.
- [ ] Notifications.
- [ ] Redis.
- [ ] Workers.

## Security

Explicitly test:

- [ ] IDOR/BOLA.
- [ ] Cross-tenant access.
- [ ] Privilege escalation.
- [ ] Missing authentication.
- [ ] Invalid JWT.
- [ ] Expired JWT.
- [ ] Unauthorized WebSocket subscription.
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

- [ ] Automate this flow.
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

- [ ] Install.
- [ ] Lint.
- [ ] Typecheck.
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] Build.
- [ ] Dependency audit.
- [ ] Secret scanning.
- [ ] CodeQL.
- [ ] Container scan.
- [ ] Helm validation.

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
- [ ] Add evidence-based indexes.
- [ ] Cache appropriate reads.
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
- [ ] Do not log sensitive data.
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

- [ ] README.
- [ ] Architecture.
- [ ] Repository structure.
- [ ] Local setup.
- [ ] Environment variables.
- [ ] Database migrations.
- [ ] Testing.
- [ ] API development.
- [ ] Worker development.
- [ ] WebSocket architecture.
- [ ] Redis architecture.

## Operations

- [ ] Docker deployment.
- [ ] Kubernetes deployment.
- [ ] Helm configuration.
- [ ] ArgoCD deployment.
- [ ] Secret management.
- [ ] Backup/restore.
- [ ] Rollback.
- [ ] Monitoring.
- [ ] Incident response.

## Security

- [ ] Threat model.
- [ ] Security architecture.
- [ ] Authentication model.
- [ ] Authorization model.
- [ ] Tenant isolation model.
- [ ] Secret management.
- [ ] Vulnerability reporting.
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

- [ ] Install succeeds.
- [ ] Lint succeeds.
- [ ] Typecheck succeeds.
- [ ] Build succeeds.

## Gate 2 — Tests

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Critical E2E path passes.
- [ ] Security tests pass.

## Gate 3 — Security

- [ ] CodeQL passes.
- [ ] Trivy passes or exceptions are documented.
- [ ] Secret scanning passes.
- [ ] No unresolved critical vulnerabilities.
- [ ] Tenant isolation verified.

## Gate 4 — Infrastructure

- [ ] Docker builds.
- [ ] Helm validates.
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

- [ ] Repository audit.
- [ ] Baseline tests.
- [ ] Architecture cleanup.
- [ ] Environment validation.
- [ ] Database schema finalization.
- [ ] Authentication hardening.
- [ ] Authorization foundation.
- [ ] Tenant isolation.

## Phase 2 — Core Product

- [ ] Organizations.
- [ ] Memberships.
- [ ] Projects.
- [ ] Tasks.
- [ ] Comments.
- [ ] Labels.
- [ ] Search/filtering.
- [ ] Dashboard.

## Phase 3 — Collaboration

- [ ] WebSockets.
- [ ] Real-time task updates.
- [ ] Real-time comments.
- [ ] Notifications.
- [ ] Redis pub/sub.
- [ ] Reconnection handling.

## Phase 4 — Async Infrastructure

- [ ] BullMQ.
- [ ] Worker jobs.
- [ ] Retry policies.
- [ ] Failure handling.
- [ ] Queue metrics.

## Phase 5 — Security

- [ ] Threat model.
- [ ] Security tests.
- [ ] Rate limiting.
- [ ] Input hardening.
- [ ] File security.
- [ ] Audit logs.
- [ ] Secret management.

## Phase 6 — Kubernetes

- [ ] Container hardening.
- [ ] Helm hardening.
- [ ] NetworkPolicies.
- [ ] Pod security.
- [ ] Probes.
- [ ] HPA.
- [ ] PDB.
- [ ] Resource limits.

## Phase 7 — Observability

- [ ] Structured logging.
- [ ] Metrics.
- [ ] Prometheus.
- [ ] Grafana.
- [ ] Alerts.
- [ ] Correlation IDs.

## Phase 8 — CI/CD

- [ ] PR pipeline.
- [ ] Security scanning.
- [ ] Container scanning.
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

| Area                  | Status | Notes                                                                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Repository foundation | 🟢     | Audited codebase, configured ESLint for apps/api & apps/worker, fixed type & lint bugs, verified install/build/lint/test |
| Architecture          | 🟢     | Layered Fastify microservice API, Next.js 14 frontend, BullMQ background worker, Redis & Postgres                        |
| Authentication        | 🟢     | JWT verification with cookie support, password hashing, registration, login & password reset                            |
| Authorization/RBAC    | 🟢     | Fastify requireRole middleware (Owner, Admin, Member, Viewer) with server-side role permission checks                   |
| Multi-tenancy         | 🟢     | Session-derived org_id scoping across all API routes with IDOR security test suite                                       |
| Database              | ⬜     |                                                                                                                          |
| Organizations         | ⬜     |                                                                                                                          |
| Projects              | ⬜     |                                                                                                                          |
| Tasks                 | ⬜     |                                                                                                                          |
| Comments              | ⬜     |                                                                                                                          |
| Search/filtering      | ⬜     |                                                                                                                          |
| Dashboard             | ⬜     |                                                                                                                          |
| WebSockets            | ⬜     |                                                                                                                          |
| Redis                 | ⬜     |                                                                                                                          |
| BullMQ/Workers        | ⬜     |                                                                                                                          |
| Notifications         | ⬜     |                                                                                                                          |
| Audit logging         | ⬜     |                                                                                                                          |
| API hardening         | ⬜     |                                                                                                                          |
| Security              | ⬜     |                                                                                                                          |
| File handling         | ⬜     |                                                                                                                          |
| Docker                | ⬜     |                                                                                                                          |
| Kubernetes            | ⬜     |                                                                                                                          |
| Helm                  | ⬜     |                                                                                                                          |
| ArgoCD                | ⬜     |                                                                                                                          |
| Observability         | ⬜     |                                                                                                                          |
| Testing               | ⬜     |                                                                                                                          |
| CI/CD                 | ⬜     |                                                                                                                          |
| Performance           | ⬜     |                                                                                                                          |
| Reliability           | ⬜     |                                                                                                                          |
| Backup/restore        | ⬜     |                                                                                                                          |
| Documentation         | ⬜     |                                                                                                                          |
| UX polish             | ⬜     |                                                                                                                          |
| Production readiness  | ⬜     |                                                                                                                          |

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
