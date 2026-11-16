# Load and failure testing (Phase 9)

How OpenPM was load-tested and failure-tested, what that found, and what changed because of it. All
numbers are from **one laptop**: Docker Desktop with **4 vCPUs and 10 GB**, running Postgres, Redis,
the API, the worker, the frontend **and k6 itself** at the same time. Treat them as relative, and as
a floor: in production the API, the database and the load generator would not share four cores.

## Running it

```bash
# 1. The stack, with the load-test overlay (exempts 127.0.0.1 from rate limiting; see below).
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build

# 2. Seed a separate "loadtest" organization: 10 users, 50 projects, 50,000 tasks, labels,
#    20,000 comments, 100,000 activity entries. Re-running replaces it. About a minute.
HASH=$(docker exec openpm-api node -e "require('bcrypt').hash('loadtest-password',12).then(h=>process.stdout.write(h))")
docker exec -i openpm-postgres psql -U openpm -d openpm -v pwhash="$HASH" < load/seed.sql

# 3. Run a test from inside the API container's network namespace, so requests come from 127.0.0.1.
#    (On Git Bash for Windows, prefix with MSYS_NO_PATHCONV=1 and use "$(pwd -W)".)
docker run --rm --network container:openpm-api -v "$PWD/load/k6:/scripts" grafana/k6:2.3.0 run /scripts/api.js
```

| Script | What it does | Knobs |
|---|---|---|
| `load/k6/api.js` | Mixed traffic: reads ramping to `PEAK_RPS` (unread count, dashboard, boards, my tasks, projects, activity, search, comments), `WRITE_RPS` writes (create task, move task, comment) and `LOGIN_RPS` logins, for about 4.5 minutes. Thresholds: < 1% errors, reads p95 < 300 ms, writes p95 < 500 ms, logins p95 < 1 s. | `PEAK_RPS` (150), `WRITE_RPS` (10), `LOGIN_RPS` (2; 0 drops logins) |
| `load/k6/endpoint.js` | One endpoint at a fixed rate, to see what each call costs on its own. | `ENDPOINT`, `RATE` (20), `DURATION` (30s) |
| `load/k6/ws.js` | `SOCKETS` clients each hold a WebSocket for `HOLD` s while tasks are created; measures connect time and end-to-end event delivery latency. | `SOCKETS` (300), `HOLD` (60), `EVENTS_RPS` (2) |
| `load/k6/jobs.js` | Queues `JOBS` assignment-email jobs (by creating assigned tasks), for worker throughput. | `JOBS` (2000) |

**Rate limiting:** the API allows 100 requests/min per IP, so a load test from one address would only
measure 429s. `RATE_LIMIT_ALLOWLIST` (IPs and CIDR ranges, empty by default) exempts addresses; the
overlay sets it to `127.0.0.1` and k6 joins the API's network namespace. The API logs a warning at
startup whenever it is set. **Never set it in production.**

## What the tests found, and what changed

| # | Found | Evidence | Change |
|---|---|---|---|
| 1 | **Boards did not scale with project size.** A board returned every task (up to 1000; 250-500 KB), with a label subquery per row. | Alone at 20 boards/s: median **4.06 s**, p95 **23 s**, API CPU 117% (saturated), Postgres 169%. | The board returns the first **100 tasks per column**, with `totals` and per-column `cursors`; "Show more" continues a column via `GET /api/tasks`. Labels load in one query. New index `(project_id, status, created_at, id)`. Now: median **8 ms**, p95 **134 ms**, API 16%, Postgres 1%. Descriptions are capped at 50,000 characters. |
| 2 | **Logins could take the whole API down.** bcrypt runs on Node's 4-thread libuv pool, which also resolves hostnames for new database/Redis connections. | Mixed 150 req/s with 2 logins/s: **46% of all requests failed** (database pool connection timeouts). Without logins: 4%. | Concurrent bcrypt work is capped (`BCRYPT_CONCURRENCY`, default 2; `security/passwords.ts`), the image sets `UV_THREADPOOL_SIZE=16`, and the pool keeps idle connections for 2 min (fewer reconnects). Logins now queue under a burst instead of starving everything else. |
| 3 | **Login timing revealed whether an account exists** (an unknown email skipped bcrypt). | Code review while fixing #2. | An unknown email is compared against a dummy hash, so both paths cost one bcrypt comparison. |
| 4 | **Text search scanned the whole organization** for terms that match little (`ILIKE '%term%'`). | 122 ms on 50,000 tasks. | `pg_trgm` GIN indexes on task title and description: **0.5 ms**. |
| 5 | **The dashboard aggregated every task** to pick 6 projects. | 57 ms per load. | Pick the 6 most recently active projects by index lookups, then count only those: **8 ms**. The redundant `(org_id)` index, which lured the planner into org-wide scans, is dropped. |
| 6 | **Overload was reported as a bug.** An exhausted database pool returned `500 Internal server error`, logged as an unhandled error per request. | Every overload run. | `503` + `Retry-After: 1`, counted in `overload_rejections_total{reason="db_pool"}`; alert `OpenPMApiOverloaded`. |
| 7 | **A Postgres restart crashed the API.** The pool's error handler called `process.exit()`. | Failure test 1: API restarted, all in-flight requests and WebSockets dropped. | The error is logged and counted (`db_connection_errors_total`); the pool reconnects. Requests while the database is unreachable get `503` + `Retry-After: 5` (`reason="db_unavailable"`). |
| 8 | **Creating a task hung while Redis was down** (BullMQ buffered the job until Redis returned; the task was already saved). | Failure test 2: no response after 30 s. | Jobs are queued best effort (`jobs/enqueue.ts`): the queue connection does not buffer, with a 2 s deadline. A failed enqueue is logged and counted (`jobs_enqueue_failed_total`; alert `OpenPMJobsNotQueued`), and the request succeeds. That email is lost; a transactional outbox would guarantee it (follow-up). |
| 9 | **Sockets closed without a code on restart** (1005), so clients could not tell a restart from a broken connection. | Failure test 4. | Graceful shutdown closes them with **1001 "Server restarting"**. |

## Results after the changes

### HTTP: one API process (mixed traffic, `api.js`)

| Load | Throughput | Errors | Reads p95 | Writes p95 | Logins p95 |
|---|---|---|---|---|---|
| **40 req/s peak** + 5 writes/s + 2 logins/s | 33 req/s average | **0%** (0 / 8,767) | **97 ms** | **149 ms** | 830 ms |
| 60 req/s peak + 8 writes/s + 2 logins/s | 49 req/s | 2.2% | 863 ms | 1.24 s | 1.83 s |
| 150 req/s peak, no logins | 88 req/s | 4.3% | 4.5 s | 3.9 s | — |

**The knee for one API process on this machine is between 40 and 60 req/s of this mix.** Past it the
Node main thread is saturated (event-loop lag p99 146 ms, max 1.2 s), requests queue for database
connections, and the excess is shed as 503s. On this machine the database, k6 and the API compete for
the same 4 cores, so this is a lower bound. Capacity grows by running more API replicas (the Helm
chart's HPA scales on CPU; live updates already work across instances via Redis pub/sub).

Per endpoint, alone at 20 req/s (median / p95): health 3 / 8 ms, unread count 4 / 14 ms, projects
3 / 11 ms, comments 6 / 13 ms, activity 9 / 22 ms, search 12 / 36 ms, my tasks 24 / 57 ms,
board 8 / 134 ms, filtered board 22 / 138 ms. All without errors.

### WebSockets (`ws.js`)

| Sockets | Connected | Events delivered | Delivery p95 / max | API while holding them |
|---|---|---|---|---|
| 300 | 300 / 300 | 21,300 / 21,300 | 57 / 149 ms | 4.5% CPU, 86 MB |
| 1,000 | 1,000 / 1,000 | 70,000 / 70,000 | 80 / 161 ms | 8.4% CPU, 96 MB |

Every event reached every socket. Connecting 1,000 sockets in the same instant took p95 1.48 s (each
does a token check, a session lookup and a Redis subscription); holding and fanning out is cheap.

### Worker (`jobs.js`)

2,000 assignment jobs drained in **13.8 s** including worker start-up (about 145 jobs/s; 14 ms per job,
concurrency 5). Email was not configured, so this is the pipeline without a provider: with a provider
that takes ~200 ms per send, one worker sends roughly 25 emails/s. Raise `WORKER_CONCURRENCY` or run
more workers for more.

### Database (50,000 tasks, `EXPLAIN ANALYZE`)

| Query | Before | After |
|---|---|---|
| Board (biggest project, 7,116 tasks) | 63 ms, up to 1,001 rows + a label subquery each | 4 bounded index scans of ≤ 101 rows + one label query |
| Text search, rare term | 122 ms (scan of every task) | 0.5 ms (trigram index) |
| Text search, common term | 1.5 ms | 2.4 ms |
| Dashboard project progress | 57 ms (aggregates every task) | 8 ms |
| My open tasks by due date | 22 ms | unchanged |
| Activity feed, projects list, unread count | ≤ 1 ms | unchanged |

## Failure tests (release gate 5)

A probe made one authenticated request and one `/health` call every 0.5-1 s throughout each test.

| Test | Result |
|---|---|
| **Postgres stopped for 20 s** | API process stays up (0 restarts) and a connected WebSocket stays open. Requests get `503` + `Retry-After`; `/health` reports `error` (not ready). Recovers by itself as soon as Postgres is back. *(Before the fix: the API crashed and restarted.)* |
| **Redis stopped for 20 s** | Every read keeps working (from Postgres); `/health` reports `degraded` and stays ready; creating a task succeeds in about 2 s (the job deadline) and the lost job is counted. Recovers by itself; a task created after recovery takes 32 ms and its job is queued. *(Before: task creation hung.)* |
| **Worker killed (`docker kill`) mid-queue** (3,000 jobs, 1,085 still waiting, 5 running) | All 3,000 jobs completed, none twice, none failed. The 5 that were running when it died were detected as stalled and re-run by BullMQ about 90 s later. |
| **API restarted** with a reconnecting WebSocket client | About 2 s without an answer. Sockets close with `1001 Server restarting`; the client reconnects about 3 s later. |
| **Database pool exhausted** (overload) | `503` + `Retry-After: 1` instead of `500`; see the HTTP results above. |

## Not covered yet

- A real cluster: these runs were Docker Compose on one machine. HPA scaling, pod restarts, rolling
  deploys under load and a real Ingress are G.5.
- Load from more than one machine, and longer soak tests (hours) for leaks.
- Guaranteed delivery of jobs when Redis is down (a transactional outbox).
- Profiling the remaining per-process ceiling (JSON serialization, validation) in detail.
