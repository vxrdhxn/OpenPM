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
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node" />
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
Frontend    Next.js 14 (App Router) + Tailwind CSS v4
Backend     Node.js + Fastify + TypeScript (strict)
Database    PostgreSQL 16
Cache       Redis 7 + BullMQ
Deploy      Docker multi-stage + Helm + ArgoCD
CI/CD       GitHub Actions + CodeQL + Trivy
```

---

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [Docker](https://www.docker.com/) + Docker Compose
- [Git](https://git-scm.com/)

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
docker-compose up --build -d
```

All 5 services start with health checks. Frontend at `:3001`, API at `:3000`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│         Next.js 14 (App Router + Tailwind v4)           │
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

- **Multi-tenant isolation**: Every DB query includes `AND org_id = $org_id`. The `org_id` is extracted from the JWT - never from the request body.
- **Stateless auth**: JWT carries identity. Any API pod can verify it. No shared session store needed for horizontal scaling.
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
├── helm/openpm/            # Kubernetes Helm chart
├── argocd/                 # ArgoCD GitOps manifests
├── grafana/                # Grafana dashboard JSON
├── k6/                     # Load test scripts
├── .github/                # CI/CD + Dependabot + Security
├── docker-compose.yml      # Local development stack
├── .env.example            # Environment variable template
└── README.md
```

---

## Deployment

### Docker Compose (small teams)

```bash
cp .env.example .env
# Edit .env with production secrets
docker-compose up --build -d
```

### Kubernetes (production)

```bash
# Create cluster (or use existing)
kind create cluster

# Install with Helm
helm install openpm ./helm/openpm -f helm/openpm/values.prod.yaml

# Verify
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

---

## Environment Variables

See [`.env.example`](.env.example) for all available configurations. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://openpm:openpm@localhost:5432/openpm` | PostgreSQL connection string |
| `REDIS_URL` | `redis://:openpm@localhost:6379` | Redis connection string |
| `JWT_SECRET` | — | **Required.** Minimum 32 characters |
| `CORS_ORIGIN` | `http://localhost:3001` | Allowed CORS origins |
| `NODE_ENV` | `development` | `development` / `production` |

---

## Security

OpenPM is designed to be self-hosted and open-source. Security is defence-in-depth:

- **Secrets**: Zero hardcoded secrets. All configuration via environment variables.
- **Auth**: bcrypt (cost 12), httpOnly cookies (SameSite=Strict), JWT with expiry.
- **Input**: Parameterised SQL queries, Fastify JSON Schema validation on all routes.
- **API**: Rate limiting, Helmet security headers, strict CORS, 1MB body limit.
- **Containers**: Non-root (UID 1001), multi-stage builds, minimal base images.
- **Network**: Kubernetes NetworkPolicy with default deny-all.
- **CI**: CodeQL static analysis, Trivy container scanning, `npm audit` checks.
- **Dependencies**: Dependabot auto-updates for npm, Actions, and Docker.

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
- `bullmq_jobs_queued_total` (counter) - background job queue depth

### Grafana Dashboard

Import `grafana/dashboards/openpm.json` for a pre-built dashboard with:
- Request rate & error rate
- p50 / p95 / p99 latency
- Pod count & HPA status
- WebSocket connections
- BullMQ queue depth
- CPU & memory per pod

### Load Testing

```bash
k6 run k6/load-test.js
```

Ramps from 0 → 500 virtual users. Thresholds: p99 < 500ms, error rate < 1%.

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
