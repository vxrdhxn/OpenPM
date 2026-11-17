# Full-stack rehearsal

How to run the whole system locally the way it runs in production (several API instances, real object
storage, real monitoring), and what the last rehearsal verified.

## Running it

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.storage.yml \
  -f docker-compose.scale.yml \
  -f docker-compose.monitoring.yml \
  up -d --build
```

| Overlay | Adds |
| --- | --- |
| `docker-compose.storage.yml` | MinIO for attachments ([attachments.md](attachments.md)) |
| `docker-compose.scale.yml` | A second API instance on `localhost:3002` (the frontend uses the first, `:3000`) |
| `docker-compose.monitoring.yml` | Prometheus (`:9090`) and Grafana (`:3003`) with the chart's own alert rules and dashboards |

Overlays are independent; use any combination. Prometheus discovers every API instance through the
`openpm-api-instances` DNS alias, so it scrapes one or two without config changes. Its labels mimic the
Helm chart's ServiceMonitors (`job` = `openpm-api` / `openpm-worker`, `namespace="compose"`), so the
shipped dashboards and alerts work unchanged.

## Last rehearsal: 2026-11-15 (commit after `092abb2`)

The stack: Postgres, Redis, two API instances, the worker, the frontend, MinIO, Prometheus and Grafana.
The browser was Chrome, driven against the real frontend.

| Check | Result |
| --- | --- |
| Realtime across instances | A task moved through API 2 (`:3002`) moved live on a board in the browser, connected to API 1. A task created in the browser through API 1 reached a WebSocket client connected to API 2. The board showed no duplicate cards. |
| Attachments in a browser | Upload via the task dialog (presigned PUT straight to MinIO, CORS), server-side content check (`ready`, 41 bytes, random key), cross-origin download of the presigned URL from the page (200, identical content), and delete from the UI (row and object removed). |
| Migrations | Covered on every CI run by the integration suite (all up, all down to an empty schema, all up). Migrations 010/011 were also rolled back and re-applied on the Compose database during F.1/F.2. |
| Prometheus | Both API instances and the worker are `up`. All 18 alert rules load and evaluate (`health: ok`). |
| Alert end to end | With the worker stopped, `OpenPMWorkerDown` went pending within 15 s, fired after its 2 min `for:`, and cleared when the worker came back. A job queued during the outage was processed after the restart. |
| Dashboards with real traffic | Every query was run against live Prometheus: API 18/23 and worker 13/15 return data. The rest are error counters (5xx, WebSocket rejections, DB/Redis errors, failed jobs) that have no series until the first error. Both dashboards render in Grafana. |

### Found and fixed

- **Every DELETE from the UI failed (400).** The frontend API client sent `Content-Type: application/json`
  on requests without a body, which Fastify rejects. So deleting an attachment or revoking an invite in
  the browser never worked. The client now sets the header only when there is a body.
- **Ratio panels showed "No data" instead of 0%** while there were no errors (5xx ratio, job failure
  ratio). They now fall back to 0.

### Not covered

- Real email delivery (no `RESEND_API_KEY` locally).
- WebSocket reconnect after an API restart, and load: there is no load test yet.
- Kubernetes: covered separately below.

## Kubernetes (kind): 2026-11-16

The Helm chart was installed on a local kind cluster (kind v0.33, Kubernetes v1.37), using locally
built images loaded with `kind load docker-image`, default values and generated secrets.

```bash
kind create cluster --name openpm
for i in api worker frontend; do kind load docker-image openpm-$i:latest --name openpm; done
helm install openpm helm/openpm -n openpm --create-namespace -f my-secrets.yaml
```

| Check | Result |
| --- | --- |
| Install | Succeeds after the fixes below. All pods ready, and migrations applied by the API init container (11 on the first pod; "up to date" on the second). |
| App flow | Register, project and assigned task through the API Service. The worker processed the job via the in-cluster Redis and Postgres. |
| NetworkPolicy (enforced by kindnet) | Allowed: API→Postgres, worker→Redis. Blocked: frontend→Postgres, frontend→Redis, worker→API. |
| Upgrade | Several `helm upgrade`s (revisions 2–10). Rolling updates replaced pods one at a time, and a config-only change (`global.logLevel`) now restarts the pods with the new value. |
| Bad upgrade + rollback | An upgrade to a missing image tag left the new pod in `ImagePullBackOff` while both old pods kept serving. `helm rollback openpm 3` removed it, and the data was intact. |
| Frontend in the cluster | Through a same-origin proxy standing in for the Ingress (`/api` and `/ws` → API, `/` → frontend): register in Chrome, empty state, board, and a live update over the WebSocket from a cluster pod. |

### Found and fixed

- **`helm install` failed with the default values:** the Postgres and Redis NetworkPolicies rendered without `apiVersion` (template whitespace trimming).
- **Postgres crash-looped:** its entrypoint needs root to `chown`, but the chart drops all capabilities. It now runs as its own uid.
- **No migrations ran, so a fresh install returned 500 on first use.** The API now has a `migrate` init container.
- **Config and secret changes didn't restart pods.** Pod templates now carry checksum annotations.
- **The frontend called `localhost:3000` in every cluster.** `NEXT_PUBLIC_*` values are build-time, so the chart's runtime values were ignored. Production builds now default to same-origin URLs.
- **A cookie the API rejects caused an endless reload between `/login` and `/projects`.** The client now clears it via `/api/auth/logout`.

`tests/helm/rendered.test.ts` now guards the chart properties above in CI.

### Not covered (closed on 2026-11-17, below)

- **Ingress controller:** the Ingress object was created but not served. Applying the downloaded ingress-nginx manifest was declined by this session's permission policy, so a local proxy with the same routing stood in for it.
- **HPA scaling:** kind has no metrics-server, so the HPAs show `cpu: <unknown>`.
- **ArgoCD sync and drift detection.**

## Kubernetes: Argo CD, Ingress and HPA (G.5): 2026-11-17

The same kind cluster, now with Argo CD (`openpm-dev` Application syncing `helm/openpm` from `main`),
Traefik as the Ingress controller and metrics-server.

| Check | Result |
| --- | --- |
| Argo CD sync | `openpm-dev` is `Synced` / `Healthy`. A change to the Application's Helm values rolled the API out with no manual step. |
| Drift (self-heal) | `kubectl scale deploy openpm-dev-worker --replicas=3` was reverted to 1 within ~2 s. |
| Ingress (Traefik) | Host `openpm.local`: `/login` → 200 from the frontend, `POST /api/auth/login` → the API's own 401, and `/ws` → `101 Switching Protocols`. The Ingress reports an address, so Argo CD marks it healthy. |
| HPA scale-up | [`load/k6/hpa.js`](../load/k6/hpa.js) at a constant 60 req/s from a pod in a separate namespace: CPU hit 230% of the request and the API went 2 → 4 → 7 replicas within ~30 s, then held at 37–57% (target 70%). 18,291 requests, 0 failed; p95 48 ms, p99 191 ms. |
| HPA scale-down | After the load stopped: 7 → 6 → 5 → 3 → 2 in ~5 min (the default 300 s stabilization window). |

The load pod's addresses were exempt from rate limiting only for the run: `RATE_LIMIT_ALLOWLIST` was
set through the live Application's `helm.valuesObject` (never in git) and removed afterwards.

```bash
kubectl patch application openpm-dev -n argocd --type merge \
  -p '{"spec":{"source":{"helm":{"valuesObject":{"api":{"extraEnv":[{"name":"RATE_LIMIT_ALLOWLIST","value":"10.244.0.0/16"}]}}}}}}'
kubectl create ns loadtest
kubectl create configmap hpa-script -n loadtest --from-file=hpa.js=load/k6/hpa.js
# run grafana/k6 with the script mounted at /s: `k6 run /s/hpa.js` (env RATE, DURATION, BASE_URL)
kubectl patch application openpm-dev -n argocd --type json -p '[{"op":"remove","path":"/spec/source/helm/valuesObject"}]'
```

### Found, not fixed

- **Every rollout scales the API up.** Node's startup CPU is well above the 100m request, so after a
  restart or rollout the HPA saw 268% and went to 4–8 replicas with no traffic, then took 5 min to
  come back to 2. Harmless on an idle cluster but wasteful, and it can scale up a whole fleet on every
  deploy. Fix options: a `behavior.scaleUp.stabilizationWindowSeconds` on the HPA, or a CPU request
  closer to real usage.
