# OpenPM — Antigravity Agent Prompt
# Manager View · Parallel Agents · Artifact Verification

---

## HOW TO USE THIS IN ANTIGRAVITY

1. Open Antigravity → Manager View → New Workspace: openpm
2. Each PHASE below = one agent
3. Paste GLOBAL CONTEXT first into the workspace knowledge base
4. Spawn agent → paste phase prompt → review Artifact → approve → agent executes
5. Phases 1-2 are sequential. Phases 3-5 run in parallel. Phase 6 runs last.

---

## GLOBAL CONTEXT
> Paste once into workspace knowledge base. All agents inherit this.

```
Project: OpenPM — self-hostable project management on Kubernetes
Repo: openpm/ (monorepo)

Stack:
  Frontend:  Next.js 14 App Router + Tailwind CSS
  Backend:   Node.js + Fastify + TypeScript strict
  Database:  PostgreSQL 16
  Cache:     Redis 7 + BullMQ
  Deploy:    Docker multi-stage + Helm + ArgoCD

Hard rules (never break):
  1. Every DB query: AND org_id = $org_id (multi-tenancy)
  2. org_id from JWT only, never request body
  3. TypeScript strict — no `any`
  4. Fastify routes have JSON schema validation
  5. Docker: multi-stage build + non-root user UID 1001
  6. K8s: resources.requests + limits + readinessProbe + livenessProbe
  7. Comments explain WHY, not just WHAT
```

---

## PHASE 1 — Foundation (sequential, run first)
### Agent name: openpm-foundation

```
BUILD the OpenPM monorepo foundation.

Structure:
openpm/
├── apps/frontend/    (Next.js 14, TypeScript strict, Tailwind)
├── apps/api/         (Fastify, TypeScript strict)
├── apps/worker/      (TypeScript strict, BullMQ)
├── helm/openpm/      (scaffold)
├── argocd/           (scaffold)
├── k6/               (scaffold)
└── docker-compose.yml

docker-compose.yml services:
  postgres:16-alpine — port 5432, healthcheck: pg_isready, volume: postgres_data
  redis:7-alpine     — port 6379, healthcheck: redis-cli ping, volume: redis_data

Database migrations in apps/api/src/db/migrations/:
  001_organizations.sql — id, name, slug(unique), created_at
  002_users.sql         — id, org_id(FK), email(unique), password_hash, name, role, created_at
                          INDEX on org_id, INDEX on email
  003_projects.sql      — id, org_id(FK), name, description, status, created_by(FK), created_at
                          INDEX on org_id
  004_tasks.sql         — id, org_id(FK), project_id(FK), title, description, status, priority,
                          assignee_id(FK), created_by(FK), due_date, created_at, updated_at
                          INDEX on org_id, project_id, assignee_id
  005_activity_log.sql  — id, org_id(FK), user_id(FK), entity_type, entity_id, action, metadata(JSONB), created_at
                          INDEX on org_id, on (entity_type, entity_id)

Migration runner: apps/api/src/db/migrate.ts
  Reads SQL files in order, tracks applied migrations in schema_migrations table
  Command: npm run migrate

apps/api/src/db/client.ts:
  pg Pool, max 20 connections
  Export: db.query<T>(sql: string, params: any[]): Promise<T[]>
  Add comment:
  // WHY max 20 connections:
  // PostgreSQL has a default max_connections of 100.
  // With 5 API pods each holding 20 connections = 100 total.
  // PgBouncer (Stage 2) will pool these further.
  // Setting a limit prevents connection exhaustion under load.

apps/api/src/cache/redis.ts:
  ioredis client
  Exports:
    cache.get<T>(key): Promise<T | null>
    cache.set(key, value, ttlSeconds): Promise<void>
    cache.del(key): Promise<void>
    cache.publish(channel, message): Promise<void>
    cache.subscribe(channel, handler): Promise<void>

VERIFY in browser:
  docker-compose up → all services healthy
  npm run migrate → all 5 tables created
  Show: psql \dt confirming tables exist
  Show: docker-compose ps with all healthy

ARTIFACT: file tree created + screenshot docker-compose healthy + screenshot psql tables
```

---

## PHASE 2 — API (sequential, after Phase 1)
### Agent name: openpm-api

```
BUILD the complete Fastify API for OpenPM.

PREREQ: Phase 1 verified. Postgres + Redis running.

apps/api/src/index.ts:
  Register: @fastify/cors, @fastify/cookie, @fastify/jwt, @fastify/swagger
  Register routes: auth, projects, tasks, websocket, metrics
  Graceful shutdown on SIGTERM
  // WHY SIGTERM handler: K8s sends SIGTERM before killing pods.
  // Without it: in-flight requests drop. With it: finish current requests, exit cleanly.
  Listen: 0.0.0.0:3000
  // WHY 0.0.0.0 not localhost: localhost = only loopback interface.
  // Inside Docker, external traffic cannot reach localhost. Must bind all interfaces.

apps/api/src/plugins/auth.ts:
  Fastify plugin: verify JWT from Authorization header or httpOnly cookie
  Attach { user_id, org_id, role } to request.user
  Return 401 if missing or expired
  /*
   * WHY JWT STATELESSNESS ENABLES HORIZONTAL SCALING:
   * Sessions store user data on the server. 3 API pods = 3 separate session stores.
   * User logged into pod 1 gets 401 on pods 2 and 3. Broken at scale.
   * JWT carries identity INSIDE the signed token itself.
   * ANY pod verifies the signature and reads user_id + org_id.
   * No shared storage needed. Scale to 20 pods with zero config changes.
   * This single decision is why stateless auth is the industry standard.
   */

Auth routes (apps/api/src/routes/auth.ts):

  POST /api/auth/register { org_name, org_slug, email, password, name }
    Validate: password>=8, email format, slug=alphanumeric+hyphens
    Check slug uniqueness → 409
    Check email uniqueness → 409
    BEGIN TRANSACTION → INSERT org → INSERT user (bcrypt cost 12, role:admin) → COMMIT
    Sign JWT { user_id, org_id, role:admin, exp:24h }
    Set httpOnly cookie + return JWT
    // WHY TRANSACTION: if user insert fails, org is rolled back. No orphan orgs in DB.
    // WHY httpOnly COOKIE: JavaScript cannot read httpOnly cookies.
    // XSS attack that steals localStorage tokens cannot steal this one.

  POST /api/auth/login { email, password }
    SELECT user by email → bcrypt.compare
    Match: JWT + cookie. No match: 401 "Invalid credentials"
    // WHY GENERIC ERROR MESSAGE: "Email not found" tells attacker which emails exist.
    // "Invalid credentials" reveals nothing. Prevents user enumeration attacks.

  GET /api/auth/me [protected]
    Return { user_id, org_id, role, name, email } from JWT — ZERO DB queries
    // WHY NO DB QUERY HERE: /me is called on every page load.
    // If it hit the DB: 100 users loading pages = 100 DB queries/min for no reason.
    // JWT contains all identity data. Decode only. Free.

  POST /api/auth/logout → clear cookie, return 200

Projects routes (apps/api/src/routes/projects.ts):
  All protected. All use org_id from request.user.org_id only.

  POST /api/projects { name, description? }
    INSERT with org_id from JWT
    Write activity_log { action:'created', entity_type:'project' }
    DEL Redis key org:{org_id}:projects
    Return created project

  GET /api/projects
    Check Redis: GET org:{org_id}:projects
    HIT: log "CACHE HIT projects" → return parsed JSON
    MISS: log "CACHE MISS projects" → SELECT WHERE org_id=$1 → SET TTL 300s → return
    /*
     * WHY CACHE THE PROJECTS LIST:
     * Every user loads this on every sidebar open.
     * 100 users with sidebar open = 100 DB queries/min without cache.
     * With Redis: 1 DB query every 5 minutes. 99 cache hits at ~1ms each.
     * Cache-aside pattern: check cache → miss → query DB → populate cache.
     * Invalidate the key whenever a project is created/updated/deleted.
     */

  GET /api/projects/:id
    SELECT WHERE id=$1 AND org_id=$2  ← ALWAYS both conditions
    404 if not found (don't reveal existence to other orgs)

  PATCH /api/projects/:id { name?, description?, status? }
    Verify ownership → UPDATE → write activity_log → DEL cache → return

  DELETE /api/projects/:id
    Check role=admin → 403 if not
    Verify ownership → DELETE (cascades to tasks via FK)
    DEL cache

Tasks routes (apps/api/src/routes/tasks.ts):
  All protected. ALL queries: WHERE ... AND org_id=$org_id

  POST /api/projects/:projectId/tasks { title, description?, priority?, assignee_id?, due_date? }
    Verify project: SELECT WHERE id=$projectId AND org_id=$org_id
    INSERT task
    Write activity_log
    Queue BullMQ job { type:'task_created', task_id, assignee_id, org_id }
    /*
     * WHY QUEUE THE JOB AND RETURN IMMEDIATELY:
     * Email/notification sending takes 1-3 seconds (external SMTP call).
     * If we await it: user waits 1-3s after clicking "Create task". Bad UX.
     * Queue it: API responds in ~20ms. Worker processes in background.
     * This is the producer/consumer pattern used in every production system.
     * API = producer (drops jobs). Worker = consumer (processes jobs).
     * They scale independently. Worker crash ≠ API downtime.
     */
    DEL cache key org:{org_id}:project:{projectId}:tasks
    Return task immediately

  GET /api/projects/:projectId/tasks
    Verify project ownership
    Cache key: org:{org_id}:project:{projectId}:tasks TTL 60s
    Return: { todo:[...], in_progress:[...], in_review:[...], done:[...] }

  PATCH /api/projects/:projectId/tasks/:taskId { status?, title?, priority?, assignee_id? }
    Verify: SELECT WHERE id=$taskId AND org_id=$org_id
    UPDATE, set updated_at=NOW()
    Write activity_log with metadata { from:oldStatus, to:newStatus }
    PUBLISH to Redis channel org:{org_id}:updates:
      { type:'task_updated', task_id, project_id, changes }
    /*
     * WHY REDIS PUBLISH HERE:
     * This event reaches ALL API pods simultaneously.
     * Each pod checks if any WebSocket clients from this org are connected.
     * If yes: forward the event to their browser.
     * Result: User B sees User A's changes in real-time without refreshing.
     * Without Redis pub/sub: pod 1 and pod 2 are isolated islands.
     */
    DEL cache → return updated task

WebSocket handler (apps/api/src/routes/websocket.ts):
  GET /ws?token={jwt}
  Verify JWT from query param (WebSocket API cannot send headers)
  Extract org_id
  SUBSCRIBE to Redis channel org:{org_id}:updates
  On Redis message: send to WebSocket client
  On WS close: UNSUBSCRIBE
  /*
   * WHY REDIS PUB/SUB BRIDGES MULTIPLE API PODS:
   * User A → pod 1 WebSocket. User B → pod 2 WebSocket.
   * User A updates task. Pod 1 saves to DB. Pod 1 PUBLISHES to Redis.
   * Redis delivers to ALL subscribers — including pod 2.
   * Pod 2 receives it. Finds User B's WebSocket. Sends the update.
   * Without this: pod 2 never knows. User B never sees the update.
   * This is EXACTLY how Slack, Figma, and Linear do real-time at scale.
   */

GET /metrics (NOT protected):
  prom-client metrics in Prometheus text format
  Tracks: http_request_duration_seconds, http_requests_total,
          active_websocket_connections, bullmq_jobs_queued_total
  /*
   * THE FOUR GOLDEN SIGNALS (Google SRE Book):
   * Latency   → http_request_duration_seconds
   * Traffic   → http_requests_total
   * Errors    → filter http_requests_total where status_code >= 500
   * Saturation → active_websocket_connections + queue depth
   * Every production dashboard is built around these four.
   */

GET /health → { status:'ok', db:'ok', redis:'ok' }
  Actually check DB + Redis connectivity (used by K8s readinessProbe)

VERIFY in browser:
  - POST /register → JWT in response + httpOnly cookie set
  - POST /login → JWT returned
  - GET /me → user data, confirm no DB log entry (stateless)
  - POST /projects → created
  - GET /projects (1st call) → logs "CACHE MISS"
  - GET /projects (2nd call) → logs "CACHE HIT"
  - POST /tasks → created, check Redis for BullMQ job
  - GET /metrics → Prometheus text output
  - GET /health → all green
  - Open Swagger at /docs → all routes listed

ARTIFACT: screenshots of register, cache hit/miss logs, metrics output, swagger UI
```

---

## PHASE 3 — Worker (parallel with 4+5)
### Agent name: openpm-worker

```
BUILD the BullMQ worker service.

PREREQ: Phase 2 verified. BullMQ jobs being queued.

apps/worker/src/index.ts:
  Connect Redis (ioredis)
  Connect PostgreSQL (pg)
  Register processors for: task_created, task_assigned
  SIGTERM handler: drain queue before exit
  /*
   * WHY DRAIN ON SIGTERM:
   * K8s sends SIGTERM when scaling down or rolling deploy.
   * If worker exits mid-job: BullMQ marks job as failed → retries it.
   * Draining lets current job finish cleanly before exit.
   */

apps/worker/src/processors/task-created.ts:
  Input: { task_id, assignee_id, org_id }
  If assignee_id:
    SELECT user WHERE id=$1 AND org_id=$2
    Log: "📧 NOTIFICATION: Task assigned to {name} <{email}>"
  Log: "✅ task_created job done: {task_id}"

  BullMQ queue config:
  /*
   * WHY EXPONENTIAL BACKOFF:
   * If SMTP server is temporarily down, immediate retry hammers it.
   * Backoff: wait 1s → 2s → 4s. Gives service time to recover.
   * This is the standard retry pattern across all distributed systems.
   *
   * WHY SEPARATE WORKER DEPLOYMENT:
   * Worker crash → API keeps running. Users keep creating tasks.
   * Separate K8s Deployment = separate health probes, separate scaling.
   * Workers scale on queue depth (KEDA in Stage 2) not HTTP traffic (HPA).
   * These are completely different scaling profiles. Never mix them.
   */
  attempts: 3
  backoff: { type: 'exponential', delay: 1000 }
  removeOnComplete: { count: 100 }
  removeOnFailed: { count: 50 }

apps/worker/Dockerfile: multi-stage, node:20-alpine, USER 1001

VERIFY:
  Start worker. Create a task with assignee via API.
  Worker logs show: "📧 NOTIFICATION: Task assigned to..."
  Kill worker mid-job. Restart. Confirm job retried.

ARTIFACT: worker logs showing notification + retry behavior after crash
```

---

## PHASE 4 — Frontend (parallel with 3+5)
### Agent name: openpm-frontend

```
BUILD the Next.js frontend.

PREREQ: Phase 2 verified.

apps/frontend/src/lib/api.ts:
  Axios instance, baseURL from NEXT_PUBLIC_API_URL, withCredentials:true
  Typed functions for all endpoints
  Response interceptor: redirect /login on 401

apps/frontend/src/lib/websocket.ts:
  Hook: useWebSocket(projectId)
  Connect to ws://api/ws?token={jwt}
  On message: call onUpdate(event)
  Disconnect: exponential backoff reconnect (1s, 2s, 4s, max 30s)
  Unmount: close connection

Pages:

/register — org name, slug, name, email, password
  Submit → api.auth.register() → redirect /dashboard

/login — email, password
  Submit → api.auth.login() → redirect /dashboard

/dashboard/layout.tsx:
  Left sidebar: logo "OpenPM", nav links, user name + logout
  Load api.auth.me() on mount → 401 → redirect /login

/dashboard/projects:
  SWR fetch projects
  // WHY SWR: stale-while-revalidate. Shows cached data immediately.
  // No loading flash. Fetches fresh in background. Standard pattern.
  Grid of project cards: name, description, task count, status
  "New Project" button → modal → optimistic add → POST api

/dashboard/projects/[id] — KANBAN BOARD (most important page):
  4 columns: To Do | In Progress | In Review | Done
  Task cards: title, priority badge (urgent=red, high=orange, medium=blue, low=gray), assignee, due date

  Drag-and-drop with @dnd-kit:
  1. User drags card to new column
  2. OPTIMISTICALLY move card in UI state IMMEDIATELY
  3. Call PATCH api in background
  4. If API fails: REVERT card to original column + show error toast
  // WHY OPTIMISTIC UPDATE:
  // Without it: card snaps back, waits for API (50-200ms), then moves. Janky.
  // With it: card moves instantly. Feels like a native app.
  // This is how Jira, Linear, Notion all work. Users expect this.

  "New Task" button per column → inline form: title, priority, assignee, due date

  useWebSocket hook:
    On 'task_updated' event: update the card in local state
    Add pulse animation on update so the student SEES real-time working
  // Opening two browser tabs and dragging in one = update in other is the proof

VERIFY in browser (must screenshot these):
  - /register working
  - /login working
  - Kanban board with tasks in all 4 columns
  - Drag task → moves immediately (optimistic) → persists on refresh
  - TWO TABS OPEN: drag in tab 1 → update appears in tab 2 (real-time proof)

ARTIFACT: screenshots of register, kanban, and THE TWO-TAB REAL-TIME SCREENSHOT
(This is the most important screenshot in the entire project)
```

---

## PHASE 5 — Docker (parallel with 3+4)
### Agent name: openpm-docker

```
BUILD all Dockerfiles and complete docker-compose.

PREREQ: Phase 2 verified (knows what services exist)

apps/api/Dockerfile:
  Stage 1 (builder): node:20-alpine
    npm ci --only=production, tsc build
  Stage 2 (runtime): node:20-alpine
    adduser UID 1001, copy dist + node_modules, USER 1001
    HEALTHCHECK: wget -qO- localhost:3000/health
    CMD: node dist/index.js
  # WHY MULTI-STAGE: builder ~800MB. Runtime ~120MB. 7x smaller.
  # Faster image pulls = faster pod startup = faster HPA scale-up.
  # WHY NON-ROOT: root in container = root on host if container escapes.
  # UID 1001 = attacker gets unprivileged user. Security baseline.

apps/worker/Dockerfile: same pattern
apps/frontend/Dockerfile:
  Stage 1: npm ci, npm run build
  Stage 2: copy .next/standalone, USER 1001, CMD: node server.js
  next.config.js: output: 'standalone'

docker-compose.yml: postgres, redis, api, worker, frontend
  All healthchecks. depends_on with conditions.
  api + worker share same env vars (DATABASE_URL, REDIS_URL, JWT_SECRET)

VERIFY:
  docker-compose up --build → all 5 services healthy
  docker images: all under 200MB
  docker stats: memory usage visible

ARTIFACT: docker-compose up screenshot + docker images sizes + docker stats
```

---

## PHASE 6 — Kubernetes + Platform (run last)
### Agent name: openpm-platform

```
BUILD Helm chart, ArgoCD, GitHub Actions, Grafana dashboard, k6 load test.

PREREQ: All phases verified. Docker images build successfully.

PART A — Helm chart (helm/openpm/):
  values.yaml: all defaults, all overridable
  templates/:
    namespace, secret, configmap
    frontend-deployment + service
    api-deployment + service
    worker-deployment + service
    postgres-deployment + service + pvc
    redis-deployment + service
    ingress (/ → frontend, /api → api, /ws → api with upgrade header)
    hpa-api (min:2, max:10, cpu:70%)
    networkpolicy (deny-all + explicit allows)
    servicemonitor (Prometheus autodiscovery)

  In api-deployment template add:
  # WHY READINESS vs LIVENESS PROBE:
  # readinessProbe: "ready to receive traffic?"
  # K8s holds requests until this passes. No 502s during rolling deploy.
  # livenessProbe: "still alive?"
  # Fails → K8s restarts pod. Automatic crash recovery.
  # Both together = zero-downtime deploys + self-healing.

  In hpa template add:
  # WHY resources.requests IS REQUIRED FOR HPA:
  # HPA calculates: current CPU / requested CPU = utilization %
  # No requests = HPA cannot calculate = HPA does nothing = crash under load.
  # Always set requests AND limits. This is the #1 HPA setup mistake.

  In networkpolicy template add:
  # WHY DEFAULT DENY-ALL:
  # Default K8s: every pod talks to every pod.
  # Compromised frontend pod could query PostgreSQL directly.
  # Default-deny + explicit allows: frontend talks to API only.
  # API talks to PostgreSQL + Redis only. Zero-trust networking.

PART B — ArgoCD (argocd/):
  app-of-apps.yaml, openpm-dev.yaml, openpm-prod.yaml
  syncPolicy: automated, prune: true
  # WHY GITOPS (no kubectl):
  # kubectl apply: one-off command, no record anywhere.
  # GitOps: every deploy = git commit = author + timestamp + diff.
  # Rollback = revert commit. ArgoCD resyncs. Full audit trail.

PART C — GitHub Actions (.github/workflows/ci.yml):
  Jobs: test → build-and-push → deploy
  Images tagged with git SHA (never 'latest')
  # WHY SHA NOT LATEST: 'latest' is mutable. SHA is immutable.
  # You know exactly what commit is running in prod at any time.
  deploy job: update values.prod.yaml image tags → git commit → ArgoCD detects → syncs

PART D — Grafana dashboard (grafana/dashboards/openpm.json):
  Panels: request rate, error rate, p50/p95/p99 latency, pod count, WebSocket connections, BullMQ queue depth, CPU per pod, memory per pod

PART E — k6 load test (k6/load-test.js):
  Stages: 0→10→100→500 users
  Thresholds: p99<500ms, error rate<1%
  Scenario: login → get projects → create task
  /*
   * HOW TO USE THIS TEST:
   * Run 1: Redis cache DISABLED → expect p99 ~600ms at 500 users
   * Run 2: Redis cache ENABLED  → expect p99 ~60ms at 500 users
   * Screenshot both Grafana dashboards side by side.
   * THAT difference is your portfolio evidence.
   * Also watch: kubectl get hpa -w (HPA scaling in real time)
   */

VERIFY:
  kind create cluster
  helm install openpm ./helm/openpm -f values.dev.yaml
  kubectl get pods -n openpm → all Running
  kubectl get hpa -n openpm → api HPA active
  Add 127.0.0.1 openpm.local to /etc/hosts
  Open http://openpm.local → OpenPM frontend loads
  Register user, create project, create task → all working on real K8s
  kubectl scale deployment api --replicas=0 → error shown
  kubectl scale deployment api --replicas=2 → recovers automatically

ARTIFACT:
  - kubectl get pods all Running
  - kubectl get hpa active
  - OpenPM at openpm.local in browser
  - Scale-down + recovery test
  - k6 running with HPA scaling simultaneously (side by side)
```

---

## FINAL CHECKLIST

```
CORE:
  [ ] Register + login + JWT working
  [ ] Projects CRUD working
  [ ] Tasks CRUD + kanban drag-and-drop
  [ ] Two-tab real-time update working (MOST IMPORTANT)
  [ ] Worker logging notifications for assignments
  [ ] BullMQ retry on simulated failure

CACHE:
  [ ] GET /projects logs CACHE HIT on second call
  [ ] GET /health returns db:ok redis:ok
  [ ] GET /metrics returns Prometheus output

KUBERNETES:
  [ ] helm install deploys all pods
  [ ] HPA active and showing CPU targets
  [ ] NetworkPolicy deny-all in place
  [ ] Scale to 0 + scale back works cleanly

PLATFORM:
  [ ] GitHub Actions all 3 jobs green
  [ ] ArgoCD syncs on git push
  [ ] Grafana dashboard with live data
  [ ] k6 load test runs + HPA scales during test
```
