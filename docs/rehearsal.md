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

### Found and fixed

- **Rollouts scaled the API up with no traffic.** A new pod's start-up uses ~180m (about twice its
  100m request) for 10–20 s, then idles at 8–10m. Whenever the HPA sampled that spike (268% after a
  cluster restart) it went to 4–8 replicas, and took 5 min to come back to 2. The CPU request is
  right for steady use (~45m per pod under load), so the HPAs now have a 60 s scale-up stabilization
  window (`api.hpa.behavior` / `frontend.hpa.behavior`) instead.

  Re-tested on kind: a cold node restart (296% sampled) and three rollouts all stayed at 2 replicas.
  Real load still scales up, 1 min later: at 60 req/s the API went 2 → 6 at ~76 s (was ~16 s) and
  settled at 8. The cost is that window: 2 pods carried the burst alone, so p95 was 953 ms (was
  48 ms) and 1 of 14,471 requests failed. Size `minReplicas` for normal peak traffic; the HPA is
  for sustained growth, not instant bursts.

## Release, deploy and rollback (Phase 8): 2026-11-17

The production path in [releasing.md](releasing.md) was rehearsed on the kind cluster. A
throwaway Argo CD app with manual sync (like `openpm-prod`) deployed the chart from `main`. Images
were pinned by digest and pulled from a local registry attached to the kind network, because
`kind load` images carry no registry digest. Two releases: v0.1.0 (the current images) and v0.2.0,
whose API image adds migration `020` (a nullable column). "Merging the deploy PR" was changing the
app's pinned images; "reverting it" was changing them back.

| Step | Result |
| --- | --- |
| Deploy v0.1.0 | Synced and healthy, running `…/openpm-api:0.1.0@sha256:6dd8…`. Smoke test passed (PostSync). A task was created. |
| Upgrade to v0.2.0 | Init container: `Applying: 020_rehearsal.sql`. Smoke test passed; a task was created; both tasks visible. |
| Roll back to v0.1.0 | Init container: `Database is up to date` (it skips the unknown `020`). Smoke test passed. v0.1.0 created a task on the v0.2.0 schema, and all three tasks were intact. |
| Smoke test failure | Run by hand with the frontend address on a wrong port: the three API checks passed, the frontend check failed after its retries, and the Job failed with its log kept. |
| Smoke test on dev | The first sync of `openpm-dev` with the chart change ran it as a PostSync hook: succeeded, Job removed. |

### Found

- **One sync of a healthy rollout was marked failed** ("one or more synchronization tasks completed
  unsuccessfully"): the app went Healthy → Degraded → Healthy during the rollout, and everything
  ended up running. Not reproduced in 5 further syncs, and the resource that was Degraded was not
  caught. If it happens in production, check that the pods are running and the smoke test passed,
  then sync again.
- A sync whose Deployment had already passed its progress deadline (from an earlier image pull
  failure) fails even after the pods recover. Syncing again succeeds.

### Not covered

- The release workflow itself has not run yet: it runs on the first `v*` tag. `actionlint`
  (including shellcheck on every script) passes.
- `argocd app rollback` (rolling back without a git revert) was not rehearsed; the documented path
  is the revert.

## Production deployment and backup/restore (Phase 11): 2026-11-17

The chart was installed on kind the way production is set up: `values.prod.yaml` with credentials
from a Secret created beforehand (`existingSecret`), and none in values or Git. Images were built
from the release candidate. Two changes from production: Postgres and Redis ran in-chart because
there is no managed database on kind, and the Ingress had no TLS.

| Check | Result |
| --- | --- |
| Install without credentials | `helm template` fails with the message naming what is missing, for each case (no JWT secret, a published one, under 32 characters, missing Postgres/Redis password). |
| Install from an existing Secret | Deployed; the chart rendered no Secret of its own. All pods ready; the post-install smoke test passed. |
| Through the Ingress | `/login` sent `frame-ancestors 'none'`, `X-Frame-Options: DENY` and no `X-Powered-By`. Sign-in and the project list worked. |
| Rate limits per client | Two in-cluster pods called through Traefik. With `api.trustProxy: "1"`, client A was limited and client B was not. With trust off (the behavior before), A's burst locked B out too (5 × 429). |
| Rate limits across pods | Before: counters were per pod, so with 2 API pods client A got 200 requests a minute. After moving them to Redis: exactly 100, then 429. |
| Backup drill, Kubernetes | `scripts/test-backup-restore.sh` with `PG_EXEC`/`MIGRATE_EXEC` on the in-chart Postgres: 14 tables, 29 rows and 19 migrations restored identically; the migrator found the copy up to date. |
| Disaster recovery | Backup → `DELETE FROM projects` (cascading to the tasks) → API and worker scaled to 0 → `restore-db.sh --replace` → scaled back. The project and its 3 tasks were back, and the same user signed in through the Ingress. |
| Backup drill, Compose | 12 MB dump: 14 tables, 230,307 rows and 19 migrations restored identically. |
| Upgrading an install made with the old defaults | `openpm-dev` (Argo CD, running since G.5 on the published default credentials), following [deploying.md](deploying.md#upgrading-an-install-made-with-the-old-defaults): `ALTER USER` with a new Postgres password, a new `openpm-secrets` Secret (new JWT secret and Redis password), then the updated Application. Argo CD synced the new commit, pruned the chart's old Secret and ran the smoke test: Synced, Healthy. All 4 users and 901 tasks were intact. |

### Found and fixed

- **Default credentials** in the chart and Compose, and **rate limits shared by everyone behind the
  Ingress and counted per pod**: see [security-review.md](security-review.md), findings 1–6.
- **Node's `fetch` drops a custom `Host` header**, so the first test calls through Traefik got 404s.
  This only affected the test client, which now uses `http.get`.

## Cloud cluster: Azure AKS, 2026-11-21

The first run on a cloud cluster. The v0.1.0 release (chart from the `v0.1.0` tag, images
`ghcr.io/vxrdhxn/openpm-*:0.1.0` pulled anonymously from GHCR) on AKS in Central India: one
`Standard_B2s_v2` node, Kubernetes v1.36, Azure CNI overlay with the Cilium dataplane (which enforces
NetworkPolicy). Traefik as the Ingress controller behind an Azure load balancer, cert-manager with a
Let's Encrypt certificate for `openpm.<ip>.sslip.io`. Postgres and Redis in-chart on Azure Disk
(`default` storage class); secrets passed at install time.

| Check | Result |
| --- | --- |
| Install | `helm install --wait` deployed; all pods ready, migrations applied by the init container, post-install smoke test passed. Volumes bound on Azure Disk. |
| TLS | A Let's Encrypt certificate was issued over HTTP-01 through the Ingress within a minute. HTTP redirects to HTTPS (301). |
| App flow from the internet | Register (cookie `HttpOnly; Secure; SameSite=Strict`), project, task and the board's task list through the public HTTPS URL. The worker processed the `task_created` job via the in-chart Redis. |
| NetworkPolicy (enforced by Cilium) | Allowed: API→Postgres, worker→Redis, frontend→API. Blocked: frontend→Postgres, frontend→Redis, worker→API. Same as on kind. |
| Upgrade to `main` | `helm upgrade` to the chart and images of `d91fa9d` (images built locally, pushed as `sha-d91fa9d`), turning on `secrets.postgres.appPassword`. The init container applied 11 migrations and created `openpm_app`; afterwards the API and worker connected only as `openpm_app`. The user and project created on 0.1.0 were intact; smoke test passed. |

### Found

- **Chart and images must come from the same release.** Installing the chart from `main` with the
  `0.1.0` images failed: the chart passes `DATABASE_MIGRATION_URL` and an app-user `DATABASE_URL`
  (least-privilege database user, added after 0.1.0), which the 0.1.0 migrator does not know, so it
  tried to sign in as a user that did not exist yet. Using the chart from the `v0.1.0` tag worked.
  **Open risk:** the production Argo CD app (`argocd/apps/openpm-prod.yaml`) syncs the chart from
  `main` (`targetRevision: HEAD`) while `values.prod.yaml` pins the images to the last release, so
  the same mismatch can reach production whenever the chart on `main` needs a newer app.
- **`helm upgrade --wait` failed** on the backup volume, which stays `Pending` until the first
  scheduled backup (Azure Disk binds on first use). Expected and documented in
  [backup-restore.md](backup-restore.md); without `--wait` (Helm 4 still waits for the smoke test)
  the upgrade succeeded.
- The worker logged one Redis `ETIMEDOUT` 12 s after starting (Redis not ready yet) and reconnected
  by itself.

### Not covered

- Argo CD, `values.prod.yaml` with an existing Secret, and a managed database (Azure Database for
  PostgreSQL); these were rehearsed on kind only.
- More than one node: PDB drains and topology spread across zones.
- Load on cloud hardware.
