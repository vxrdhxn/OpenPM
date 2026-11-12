# Observability

Logs, metrics and dashboards for the API and the worker.

## Logging

Both processes write **JSON, one object per line, to stdout**. Collect them with whatever your
platform provides (Loki, ELK, CloudWatch, ...).

| Field | Meaning |
|---|---|
| `level` | `fatal` `error` `warn` `info` `debug` `trace` (a label, not a number) |
| `time` | ISO-8601 |
| `service` | `openpm-api` or `openpm-worker` |
| `request_id` | Id of the HTTP request. Also returned as the `X-Request-Id` response header. |
| `user_id`, `org_id` | Added to every line of an authenticated request. Ids only: never an email, name or token. |
| `job_id`, `job_name` | Worker lines only |
| `event` | Machine-readable tag on security events: `auth_failure`, `login_failed` |

Set the level with `LOG_LEVEL` (default `info`; Helm: `global.logLevel`).

### Following one action end to end

1. A client may send `X-Request-Id`. A well-formed value (8-128 chars of `A-Z a-z 0-9 . _ -`) is kept so
   an id can follow a request across an ingress and services; anything else is replaced by a new
   UUID and never logged or echoed.
2. When a request enqueues a job, the id travels with it, so the worker logs under the same
   `request_id`.

```bash
# everything that happened for one request, API and worker together
kubectl logs -l app.kubernetes.io/instance=openpm --all-containers | jq -c 'select(.request_id=="<id>")'
```

### What is never logged

- Credentials are redacted before writing (`authorization`, `cookie`, `set-cookie`, `password`,
  `password_hash`, `token`, `secret`, `secretAccessKey`, `apiKey`), wherever they appear in an object.
- Authentication failures log a reason (`missing`, `expired`, `invalid`, `bad_credentials`), never the
  credential, and failed logins do not record the email address.
- The worker logs emails by recipient **domain** and provider message id only. Without
  `RESEND_API_KEY`, development prints the whole mail so you can read it; with `NODE_ENV=production`
  it logs a warning with the domain and nothing else.

Log retention is not defined by the application: set it in your log platform.

## Metrics

| Process | Endpoint | Notes |
|---|---|---|
| API | `GET :3000/metrics` | Unauthenticated. The ingress routes only `/api` and `/ws`, so it is not exposed externally; keep it that way. |
| Worker | `GET :9100/metrics` (`METRICS_PORT`) | Also serves `/healthz`. Cluster-internal; the NetworkPolicy admits only Prometheus. |

Label values come from small fixed sets, so cardinality is bounded (no ids, emails or SQL).

### API

| Metric | Labels | Meaning |
|---|---|---|
| `http_requests_total` | `method route code` | Requests. `code="429"` = rate limited. |
| `http_request_duration_seconds` | `method route code` | Latency histogram (5 ms to 10 s). |
| `active_websocket_connections` | | Open authenticated sockets on this pod. |
| `websocket_rejections_total` | `reason` | `unauthorized`, `origin`, `subscription_failed`. |
| `websocket_errors_total` | | Socket-level errors. |
| `auth_failures_total` | `reason` | `missing`, `expired`, `invalid`, `bad_credentials`. |
| `db_query_duration_seconds` | `outcome` | Queries through `db.query` (`ok`/`error`). Transactions are not included. |
| `db_pool_connections` | `state` | `total`, `idle`, `waiting`. |
| `redis_errors_total` | `client` | `main`, `subscriber`. |
| `nodejs_*`, `process_*` | | Default Node.js process metrics. |

### Worker

| Metric | Labels | Meaning |
|---|---|---|
| `worker_jobs_total` | `job_name status` | `completed` / `failed`. Unknown job names are reported as `other`. |
| `worker_job_duration_seconds` | `job_name` | Processing time, failures included. |
| `worker_queue_jobs` | `state` | `waiting`, `active`, `delayed`, `failed`. |
| `worker_queue_oldest_waiting_age_seconds` | | **Queue lag**: age of the oldest waiting job (0 when empty). |
| `emails_total` | `result` | `sent`, `failed`, `skipped` (no provider configured). |

The two `worker_queue_*` metrics describe the queue, not a pod, so every worker replica reports the
same numbers. Query them with `max()`, never `sum()`.

## Enabling it in Kubernetes (Helm)

```yaml
serviceMonitor:
  enabled: true          # scrape API and worker (needs the Prometheus Operator)
  namespace: monitoring  # optional: create the monitors where Prometheus looks

grafana:
  dashboards:
    enabled: true        # ship the dashboards as a ConfigMap for Grafana's sidecar
    namespace: monitoring
    labels:
      grafana_dashboard: "1"   # the kube-prometheus-stack default

networkPolicy:
  metricsIngressFrom:    # who may scrape the worker; match where your Prometheus runs
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: monitoring
```

Dashboards (in `helm/openpm/dashboards/`):

- **OpenPM / API**: traffic, status codes, latency percentiles and p95 per route, 5xx and 429 rates,
  authentication failures, WebSocket rejections, database latency/errors/pool, Redis errors,
  event-loop lag, memory, CPU.
- **OpenPM / Worker and queue**: jobs waiting, queue lag, failed jobs, throughput, duration
  percentiles, failure ratio, emails by result, runtime.

A test (`tests/observability/dashboards.test.ts`, run by `npm test`) checks every query against the
metrics the code really registers (metric names, labels, legend labels, variables, grid layout), so
a renamed metric or a typo fails the build instead of leaving an empty panel.

## Not covered yet

- **Alerts.** No alert rules are shipped. Good starting points: 5xx ratio above 5% for 5 minutes,
  `worker_queue_oldest_waiting_age_seconds` above 60 s, `worker_queue_jobs{state="failed"}` above 0,
  `db_pool_connections{state="waiting"}` above 0 for several minutes.
- **Verification in real Grafana/Prometheus.** The Helm templates were rendered and linted, and the
  dashboards' queries are checked structurally against the code, but they have not been loaded into a
  live Grafana or run against a live Prometheus. Expect to adjust thresholds after real traffic.
- **docker-compose** does not run Prometheus or Grafana.
- **Tracing** (spans across services) is not implemented; request ids cover correlation by log search.
- **Log retention** and the worker's retry policy (jobs are enqueued without retries) are not defined.
