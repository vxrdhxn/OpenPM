<p align="center">
  <img src="docs/assets/logo.svg" alt="OpenPM" width="80" />
</p>

<h1 align="center">OpenPM</h1>

<p align="center">
  <strong>Self-hostable project management - built for teams that own their data.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

---

## Why OpenPM?

Most project management tools are SaaS-only. Your data lives on someone else's servers, your workflows are locked behind their pricing tiers, and one API change breaks your integrations.

**OpenPM is different.** Deploy it on your infrastructure - a single Docker Compose command for small teams, or a production Helm chart on Kubernetes for scale. You own everything.

---

## Features

| Feature | Description |
|---------|-------------|
| **Kanban Boards** | Drag-and-drop task management with real-time sync across all connected clients |
| **Real-Time Collaboration** | WebSocket-powered live updates - see changes as they happen, no refresh needed |
| **Multi-Tenant** | Full organization isolation. Every query is scoped by `org_id` from JWT - zero cross-tenant leakage |
| **Background Workers** | BullMQ-powered async job processing for notifications, with exponential backoff retry |
| **Cache Layer** | Redis cache-aside pattern on hot paths. Sub-millisecond reads on repeated queries |
| **Observability** | Prometheus metrics, Grafana dashboards, structured logging - production-ready from day one |
| **Kubernetes-Native** | Helm chart with HPA, NetworkPolicy, PodDisruptionBudget, and SecurityContext hardening |
| **GitOps Ready** | ArgoCD manifests for automated, auditable deployments. Every deploy = a git commit |

---

## Tech Stack

```
Frontend    Next.js 16 (App Router) + React 19 + Tailwind CSS v4
Backend     Node.js 22 + Fastify 5 + TypeScript (strict)
Database    PostgreSQL 16
Cache       Redis 7 + BullMQ
Deploy      Docker multi-stage + Helm + ArgoCD
CI/CD       GitHub Actions (lint, build, unit/integration/browser tests, Helm, gitleaks, Trivy, CodeQL)
```

---

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22
- [Docker](https://www.docker.com/) + Docker Compose
- [Git](https://git-scm.com/)

### Fastest way: run everything in Docker

```bash
git clone https://github.com/YOUR_ORG/openpm.git
cd openpm
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env   # signs sessions; there is deliberately no default
echo "DATABASE_APP_PASSWORD=$(openssl rand -hex 24)" >> .env   # the API's own, least-privilege database user
docker compose up --build
```

Then open <http://localhost:3001> and register: the first account creates your organization.
Database migrations run automatically (a one-shot `migrate` service runs before the API starts).
`JWT_SECRET` and `DATABASE_APP_PASSWORD` are the only settings you must provide. Stop it with `docker compose down` (add `-v` to
also delete the data). Running it for real: [`docs/deploying.md`](docs/deploying.md).

For development with hot reload, use the steps below instead.

### 1. Clone & configure

```bash
git clone https://github.com/YOUR_ORG/openpm.git
cd openpm
cp .env.example .env
```

Edit `.env` with your secrets (or keep defaults for local dev).

### 2. Start infrastructure

```bash
docker-compose up -d postgres redis
```

### 3. Run migrations

```bash
npm install
npm run migrate
```

### 4. Start development servers

```bash
# Terminal 1 — API
npm run dev:api

# Terminal 2 — Worker
npm run dev:worker

# Terminal 3 — Frontend
npm run dev:frontend
```

Open [http://localhost:3001](http://localhost:3001) and register your first organisation.

### One-command production (Docker Compose)

```bash
docker compose up --build -d     # after setting JWT_SECRET (and passwords) in .env: docs/deploying.md
```

All 5 services start with health checks. Frontend at `:3001`, API at `:3000`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│         Next.js 16 (App Router + Tailwind v4)           │
└──────────────┬──────────────────────┬───────────────────┘
               │ REST (HTTPS)         │ WebSocket (WSS)
               ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│                    Fastify API                          │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐  │
│  │  Auth    │ │ Projects │ │   Tasks   │ │  Metrics │  │
│  │  (JWT)   │ │  (CRUD)  │ │(CRUD+WS)  │ │  (Prom)  │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────┘  │
│  Helmet · Rate-Limit · CORS · JSON Schema Validation   │
└──────┬──────────────┬───────────────┬───────────────────┘
       │              │               │
       ▼              ▼               ▼
┌────────────┐ ┌────────────┐ ┌──────────────┐
│ PostgreSQL │ │   Redis    │ │  BullMQ      │
│    16      │ │     7      │ │  Worker      │
│            │ │ Cache +    │ │  (async      │
│ Multi-     │ │ Pub/Sub    │ │  jobs)       │
│ tenant     │ │            │ │              │
└────────────┘ └────────────┘ └──────────────┘
```

### Key Design Decisions

- **Multi-tenant isolation**: Every query is scoped to the caller's organization (`org_id`), directly or through an org-scoped ownership check in the same transaction. The `org_id` comes from the verified session, never from the request.
- **Sessions**: A signed JWT in an httpOnly cookie carries identity, so any API pod can verify it. Each request also checks the user's current role and token version in Postgres (one indexed lookup), so sign-out-everywhere, removal and role changes take effect immediately. There is no separate session store.
- **Cache-aside pattern**: Hot paths (project lists, task boards) are cached in Redis with TTL. Cache is invalidated on writes.
- **Async processing**: Task notifications are queued in BullMQ and processed by a separate worker. API responds in ~20ms. The worker scales independently.
- **Redis Pub/Sub**: Real-time updates bridge multiple API pods. User A on pod 1 updates a task → pod 2 receives via Redis → pushes to User B's WebSocket.

---

## Project Structure

```
openpm/
├── apps/
│   ├── api/                # Fastify REST API + WebSocket
│   │   ├── src/
│   │   │   ├── db/         # PostgreSQL client + migrations
│   │   │   ├── cache/      # Redis client
│   │   │   ├── plugins/    # Fastify plugins (auth, etc.)
│   │   │   ├── routes/     # Route handlers
│   │   │   └── index.ts    # Server entrypoint
│   │   └── Dockerfile
│   ├── frontend/           # Next.js 14 App Router
│   │   ├── src/
│   │   │   ├── app/        # Pages and layouts
│   │   │   ├── components/ # Reusable UI components
│   │   │   └── lib/        # API client, WebSocket hook
│   │   └── Dockerfile
│   └── worker/             # BullMQ job processor
│       ├── src/
│       │   ├── processors/ # Job handlers
│       │   └── index.ts    # Worker entrypoint
│       └── Dockerfile
├── helm/openpm/            # Kubernetes Helm chart (also the Grafana dashboards and alert rules)
├── argocd/                 # ArgoCD GitOps manifests
├── load/                   # k6 load tests and seed data (docs/load-testing.md)
├── .github/                # CI/CD + Dependabot + Security
├── docker-compose.yml      # Local development stack
├── .env.example            # Environment variable template
└── README.md
```

---

## Deployment

Full guide, including credentials and running behind a proxy: [`docs/deploying.md`](docs/deploying.md).
Backups: [`docs/backup-restore.md`](docs/backup-restore.md).

### Docker Compose (small teams)

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "DATABASE_APP_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up --build -d
```

### Kubernetes (production)

The chart has no default credentials. Create them as a Secret first, then install:

```bash
kubectl create namespace openpm
kubectl -n openpm create secret generic openpm-secrets   --from-literal=JWT_SECRET="$(openssl rand -hex 32)"   --from-literal=DATABASE_URL='postgresql://...' --from-literal=REDIS_URL='redis://...'
helm install openpm ./helm/openpm -n openpm -f helm/openpm/values.prod.yaml

kubectl get pods -n openpm
kubectl get hpa -n openpm
```

Features included in the Helm chart:
- **HPA**: Auto-scales API pods (min 2, max 10, target 70% CPU)
- **NetworkPolicy**: Default deny-all with explicit service-to-service rules
- **SecurityContext**: Non-root, read-only filesystem, dropped capabilities
- **PodDisruptionBudget**: Ensures availability during rolling deploys
- **ServiceMonitor**: Prometheus auto-discovery for metrics

### GitOps (ArgoCD)

```bash
kubectl apply -f argocd/app-of-apps.yaml
# ArgoCD syncs from git. Every deploy = a git commit.
```

- `openpm-dev` syncs automatically, with prune and self-heal: a manual change in the cluster is
  reverted within seconds. `openpm-prod` syncs **manually**, so production only changes when someone
  syncs a reviewed revision (`argocd app sync openpm-prod`, or pin `targetRevision` to a tag).
- The Ingress is a standard Kubernetes Ingress for any controller; set `ingress.className` (empty =
  the cluster default). Argo CD reports the app healthy once the controller publishes the Ingress's
  address. Verified with Traefik; ingress-nginx is retired and no longer patched.
- The HPAs need [metrics-server](https://github.com/kubernetes-sigs/metrics-server) (or another
  metrics API) in the cluster.

What was verified on a local cluster (sync, drift, prune, Ingress, WebSockets, HPA) is in
[`docs/rehearsal.md`](docs/rehearsal.md).

### Releases

Tag `vX.Y.Z` on `main` and the release workflow publishes the images to GHCR, creates a GitHub Release
and opens a PR that pins production to the new image digests. Merging it and syncing `openpm-prod` is
the deploy; a smoke test runs after every sync. Reverting it and syncing again is the rollback. See
[`docs/releasing.md`](docs/releasing.md).

---

## Environment Variables

See [`.env.example`](.env.example) for all available configurations. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://openpm:openpm@localhost:5432/openpm` | PostgreSQL connection string |
| `DATABASE_MIGRATION_URL` | _(unset)_ | Migrations only: the database owner. When set, `DATABASE_URL` is a least-privilege app user that migrations create and grant ([docs/database-access.md](docs/database-access.md)) |
| `AUDIT_RETENTION_DAYS` | `365` | How long the security audit log keeps entries ([docs/audit-log.md](docs/audit-log.md)) |
| `CSP_CONNECT_SRC` | _(empty)_ | Frontend: extra origins the browser may connect to, for the Content-Security-Policy. Set it to the object storage's public origin when attachments are on |
| `REDIS_URL` | `redis://:openpm@localhost:6379` | Redis connection string |
| `JWT_SECRET` | dev key outside production | **Required when `NODE_ENV=production`**: the API refuses to start without it or with an example value from this repository. Minimum 32 characters |
| `CORS_ORIGIN` | `http://localhost:3001` | Allowed CORS origins |
| `TRUST_PROXY` | _(unset)_ | Proxies whose `X-Forwarded-For` the API believes: a hop count (`1` behind one Ingress; the chart sets it) or IPs/CIDRs. Needed for per-client rate limits behind a proxy ([docs/deploying.md](docs/deploying.md#behind-a-proxy)) |
| `NODE_ENV` | `development` | `development` / `production` |
| `APP_URL` | `http://localhost:3001` | Public frontend URL used in emailed links (invites). **Required for the worker in production** |
| `RESEND_API_KEY` | _(empty)_ | Email delivery. Empty: emails are printed in development and not sent in production (Helm: `secrets.resendApiKey`) |

---

## Security

OpenPM is designed to be self-hosted and open-source. Security is defence-in-depth:

- **Secrets**: No built-in credentials. Compose and the Helm chart refuse to start without them, and the API refuses example secrets from this repository in production. Kubernetes can read them from an existing Secret.
- **Auth**: bcrypt (cost 12), httpOnly cookies (SameSite=Strict), JWT with expiry and server-side revocation.
- **Audit**: sign-ins, failed sign-ins, password changes and permission changes in a security log for admins ([docs/audit-log.md](docs/audit-log.md)).
- **Input**: Parameterised SQL queries, Fastify JSON Schema validation on all routes, NUL bytes refused, a WebSocket that accepts no client messages.
- **API**: Rate limiting, Helmet security headers, strict CORS, 1MB body limit.
- **Browser**: a nonce-based Content-Security-Policy on every page, no framing.
- **Database**: the API connects as a user that cannot change the schema or the audit log ([docs/database-access.md](docs/database-access.md)).
- **Design**: [security model](docs/security-model.md) and [threat model](docs/threat-model.md).
- **Containers**: Non-root (UID 1001), multi-stage builds, minimal base images.
- **Network**: Kubernetes NetworkPolicy with default deny-all.
- **CI**: gitleaks secret scanning, Trivy image scanning (blocks fixable HIGH/CRITICAL findings), CodeQL, Helm lint and render checks, and `npm audit` (blocks high and critical). See [docs/ci.md](docs/ci.md).
- **Dependencies**: Dependabot auto-updates for npm, Actions, and Docker.

The pre-release review, what it fixed and the known limits: [`docs/security-review.md`](docs/security-review.md).

### Reporting Vulnerabilities

Please use [GitHub Security Advisories](../../security/advisories/new) to report vulnerabilities privately. We take all reports seriously and will respond within 48 hours.

**Do not** open public issues for security vulnerabilities.

---

## Observability

### Metrics (Prometheus)

The API exposes `/metrics` in Prometheus text format:
- `http_request_duration_seconds` (histogram) - latency by route
- `http_requests_total` (counter) - request count by method, route, status
- `active_websocket_connections` (gauge) - current WebSocket connections
- `db_query_duration_seconds`, `cache_bypassed_total`, `auth_failures_total`, ...

The worker exposes job outcomes, durations and queue depth (`worker_jobs_total`, `worker_queue_jobs`, ...).
The full list, with what each alert means, is in [`docs/observability.md`](docs/observability.md).

### Grafana Dashboards

Two dashboards ship with the Helm chart, in `helm/openpm/dashboards/` (`openpm-api.json`,
`openpm-worker.json`): request and error rates, latency percentiles, WebSocket connections, database
latency and pool usage, and job throughput and queue depth. Set `grafana.dashboards.enabled=true` to
load them through the Grafana sidecar, or import the JSON directly. To try them locally against real
traffic, use `docker-compose.monitoring.yml` (see `docs/observability.md`).

### Load Testing

k6 scripts for mixed HTTP traffic, single endpoints, 1,000 concurrent WebSockets and worker
throughput live in `load/`, with a seed of 50,000 tasks (`load/seed.sql`) and a Compose overlay for
running them (`docker-compose.loadtest.yml`). [`docs/load-testing.md`](docs/load-testing.md) has the
commands, the measured baselines, the failure tests (Postgres, Redis, worker and API restarts) and
what each finding changed.

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/YOUR_ORG/openpm.git
cd openpm
cp .env.example .env
docker-compose up -d postgres redis
npm install
npm run migrate
npm run dev:api    # Terminal 1
npm run dev:worker # Terminal 2
npm run dev:frontend # Terminal 3
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

This means you can freely use, modify, and distribute OpenPM, but if you offer it as a network service (e.g., a managed SaaS), you must release your modifications under the same license.

---

<p align="center">
  Built with ♥ for teams that own their tools.
</p>
