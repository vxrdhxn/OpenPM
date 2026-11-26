# Deploying OpenPM

Two supported ways: **Docker Compose** on one machine, or the **Helm chart** on Kubernetes (by hand
or through Argo CD). Releases, upgrades and rollback are in [releasing.md](releasing.md), backups in
[backup-restore.md](backup-restore.md).

## Credentials

OpenPM ships no usable default credentials. Anyone who knows `JWT_SECRET` can sign in as any user
of any workspace, so a value published in this repository is never accepted:

- The **API** refuses to start with `NODE_ENV=production` if `JWT_SECRET` is missing or is one of
  the example values from this repository.
- The **Helm chart** refuses to render without a JWT secret of at least 32 characters, and without
  passwords for the in-chart Postgres and Redis.
- **Docker Compose** refuses to start without `JWT_SECRET` and `DATABASE_APP_PASSWORD` in `.env`.

Generate secrets with `openssl rand -hex 32`.

### Docker Compose

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "DATABASE_APP_PASSWORD=$(openssl rand -hex 24)" >> .env  # the API's own database user
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env     # before the first start
echo "REDIS_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose up -d --build
```

The API and worker connect to Postgres as `openpm_app`, which can change rows but not the schema;
migrations create it ([database-access.md](database-access.md)).

Postgres and Redis listen on `127.0.0.1` only. The API (`:3000`) and frontend (`:3001`) listen on
every interface; put a TLS-terminating proxy in front of them for anything beyond a trusted network.

### Kubernetes: an existing Secret (recommended)

Create the Secret before the first install or sync, and point the chart at it. Credentials then
never pass through Git or Helm values:

```bash
kubectl create namespace openpm
kubectl -n openpm create secret generic openpm-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL='postgresql://APP_USER:PASSWORD@HOST:5432/openpm' \
  --from-literal=DATABASE_MIGRATION_URL='postgresql://OWNER:PASSWORD@HOST:5432/openpm' \
  --from-literal=REDIS_URL='redis://:PASSWORD@HOST:6379/0' \
  --from-literal=RESEND_API_KEY='re_...'          # optional: outgoing email
helm install openpm helm/openpm -n openpm -f helm/openpm/values.prod.yaml   # sets existingSecret
```

With the in-chart Postgres and Redis (`postgres.enabled`, `redis.enabled`), the Secret also needs
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `REDIS_PASSWORD`. `DATABASE_URL` and
`REDIS_URL` must then point at the chart's services (`<release>-postgres:5432`,
`<release>-redis:6379`) with the same passwords.

`DATABASE_MIGRATION_URL` is optional but recommended: with it, migrations run as the owner and the
API and worker as an app user that cannot change the schema ([database-access.md](database-access.md)).
Without it, everything uses `DATABASE_URL`.

Both Argo CD applications (`argocd/apps/`) read a Secret named `openpm-secrets` in their namespace.
External Secrets or Sealed Secrets can create it; the chart only needs the keys above.

The chart restarts pods when a Secret *it renders* changes. After changing an existing Secret,
restart them yourself: `kubectl -n openpm rollout restart deploy`.

### Kubernetes: values at install time

For a quick evaluation, the chart can render the Secret itself:

```bash
helm install openpm helm/openpm -n openpm --create-namespace \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set secrets.postgres.password="$(openssl rand -hex 16)" \
  --set secrets.redis.password="$(openssl rand -hex 16)" \
  --set secrets.postgres.appPassword="$(openssl rand -hex 24)"   # optional: least-privilege app user
```

Keep those values: every later `helm upgrade` needs the same ones (`--reuse-values` keeps them).

## Content-Security-Policy and attachments

Every page carries a Content-Security-Policy that only lets the browser connect to this host and
the API ([security-model.md](security-model.md#browser-protections)). Attachments upload straight
from the browser to object storage, so tell the frontend its public origin, the same as the API's
`S3_PUBLIC_ENDPOINT`:

- Helm: `frontend.cspConnectSrc: "https://files.example.com"`
- Compose: `CSP_CONNECT_SRC` on the `frontend` service (`docker-compose.storage.yml` sets it for MinIO)

Without it, uploads fail with a CSP error in the browser console. The setting is read at runtime;
no rebuild is needed.

## Frontend and API on different hosts

The chart serves the frontend, `/api` and `/ws` on one host, which needs no extra settings. To run
them apart (e.g. the frontend on a static/edge host and the API elsewhere), put them on **subdomains
of one domain**, such as `app.example.com` and `api.example.com`:

- **API:** `COOKIE_DOMAIN=example.com` (Helm: `api.cookieDomain`), so the sign-in cookie is shared
  with the frontend, whose middleware checks it on every page. `CORS_ORIGIN=https://app.example.com`.
- **Frontend build:** `NEXT_PUBLIC_API_URL=https://api.example.com/api` and
  `NEXT_PUBLIC_WS_URL=wss://api.example.com/ws` (inlined at build time). The Content-Security-Policy
  allows these origins by itself.

Two unrelated domains (`*.vercel.app` + `*.azurecontainerapps.io`) do not work this way: the cookie
is `SameSite=Strict` and belongs to one site, so the frontend never sees it and sends you back to
sign-in. Without a domain of your own, proxy the API through the frontend instead:

## Frontend on Vercel, API elsewhere, no custom domain

The frontend serves the API at its own `/api` (a Next.js rewrite), so the sign-in cookie belongs to
the frontend's domain. WebSockets cannot go through that rewrite, so the browser connects straight to
the API with a single-use ticket (`docs/realtime.md`).

- **Frontend build (Vercel project settings):** `API_PROXY_TARGET=https://<api host>` and
  `NEXT_PUBLIC_WS_URL=wss://<api host>/ws`. Leave `NEXT_PUBLIC_API_URL` unset (same origin).
- **API:** `CORS_ORIGIN=https://<app>.vercel.app`, `APP_URL` the same, `COOKIE_DOMAIN` unset.
  `TRUST_PROXY=2` when the API sits behind its own ingress (Azure Container Apps): Vercel sets
  `X-Forwarded-For` to the client, and the ingress appends Vercel's address.

## Values are checked

`helm/openpm/values.schema.json` is applied on every `helm install`, `upgrade`, `template` and Argo
CD sync. A misspelled key in the chart's own sections (`api.replicaCnt`) is refused, not silently
ignored, and so are settings with known rules: log level, sign-up verification mode, image digests,
pull policies, ports, `trustProxy`, `corsOrigin`, Redis `maxMemory`, ingress backends. Kubernetes
objects passed through (`resources`, `securityContext`, HPA `behavior`, NetworkPolicy peers) are
validated by Kubernetes itself.

## Spreading pods

The API, frontend and worker pods spread across nodes, then zones (`topologySpread.enabled`, on by
default), so one node or zone going down does not take every replica of an app with it. The rule
is soft: on a cluster with fewer nodes than replicas, all pods still schedule. Together with the
PodDisruptionBudgets (`maxUnavailable: 1`), a node drain moves one pod of each app at a time.

## Behind a proxy

Rate limits (100 requests a minute per client, stricter on sign-in, counted in Redis across all API
pods) need the client's real address.
The API believes `X-Forwarded-For` only from the proxies `TRUST_PROXY` names:

| Setting | Meaning |
| --- | --- |
| unset (Compose default) | The API is reached directly; the header is ignored, so clients cannot fake their address. |
| `1` (chart default, `api.trustProxy`) | One proxy in front, the Ingress controller. |
| `2`, `3`, ... | One more for each proxy in front of the controller that appends to the header (e.g. a cloud L7 load balancer). |
| `10.0.0.0/8,192.168.1.4` | Trust exactly these proxy addresses. |

Too low: all users behind the proxy share one limit. Too high: clients can set their own address and
dodge the limit.

## Upgrading an install made with the old defaults

Before v0.1.0 the chart and `docker-compose.yml` had built-in credentials. An install that used
them has a publicly known JWT secret (and Postgres/Redis passwords); rotate them when upgrading:

1. **JWT secret:** set a new one. Everyone is signed out once.
2. **Postgres password:** `POSTGRES_PASSWORD` only applies when the data directory is first
   created, so change it in the database too, then in the Secret or `.env`:

   ```bash
   kubectl -n openpm exec deploy/openpm-postgres -- \
     psql -U openpm -d openpm -c "ALTER USER openpm PASSWORD 'NEW_PASSWORD'"
   ```

   With Compose: `docker compose exec postgres psql -U openpm -d openpm -c "ALTER USER ..."`.
3. **Redis password:** Redis reads it at start, so updating the Secret or `.env` and restarting is
   enough.
