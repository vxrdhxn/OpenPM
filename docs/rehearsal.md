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
- Kubernetes: the Helm chart has not been installed on a cluster (G.4).
