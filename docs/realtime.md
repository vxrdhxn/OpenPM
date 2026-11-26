# Realtime: WebSocket, events and Redis

## How an event reaches a browser

```
API pod / worker ──PUBLISH org:<org id>:updates──▶ Redis ──▶ every API pod's subscriber
                                                               │  (one connection per pod, reference-counted
                                                               ▼   channels: apps/api/src/realtime/hub.ts)
                                         each socket of that organization on the pod
                                         (filtered for private projects, then sent)
```

- **One channel per organization:** `org:<org id>:updates`. A socket's channel comes from its
  session token, never from the client, so it only ever hears its own organization.
- **The socket is one-way.** Clients cannot send anything; a message closes the socket (1008).
- **Authentication:** the web app first calls `POST /api/realtime/ticket` (with its cookie) and
  connects to `/ws?ticket=<ticket>`. A ticket is 256 random bits, works once, expires after 30 s,
  and Redis keeps only its hash; it carries the session it was issued for. This lets the socket
  reach an API on another domain than the page (Vercel, see `docs/deploying.md`), where the
  `SameSite=Strict` cookie is not sent. Other clients may use the `auth_token` cookie or
  `Authorization: Bearer`. Session tokens are never accepted in the URL. The session is checked
  on connect and at every heartbeat (30 s). A revoked session closes with `Session revoked`.
  The handshake's `Origin` must be `CORS_ORIGIN`.
- **Private projects:** each socket keeps the set of projects its user cannot see (reloaded on
  `project_access_changed` and at each heartbeat), and drops every event about them.

## Envelope, ordering and duplicates

Every event is a JSON object with a `type`, plus:

| Field | Meaning |
| --- | --- |
| `event_id` | A UUID, unique per event (`withEnvelope` in `cache/redis.ts`; the worker adds the same). |
| `published_at` | When it was published (ISO 8601). |

- **Ordering:** Redis delivers a channel's messages in the order they were published. Each socket
  handles its events one at a time, in that order, access reloads included. There is no order across
  organizations, and none is needed.
- **Duplicates:** Redis pub/sub delivers each message at most once per subscriber. A client may
  still see a change twice: as an event and again in a refetch. Events are safe to apply twice.
  `task_*` events carry the whole task, comment events the whole comment, and the rest only tell the
  client to refetch. A client can also drop an `event_id` it has already seen.
- **Missed events are not replayed.** While Redis or the socket is down nothing is delivered. A
  client refetches what it shows after every reconnect (the web app does).

## Events

| `type` | Payload | Sent when |
| --- | --- | --- |
| `task_created` | `project_id`, `task` | a task is created |
| `task_updated` | `project_id`, `task_id`, `changes`, `task` (or only `changes.labels` for a label change) | a task or its labels change |
| `task_deleted` | `project_id`, `task_id` | a task is deleted |
| `comment_created` / `comment_updated` | `project_id`, `task_id`, `comment` | see `docs/comments.md` |
| `comment_deleted` | `project_id`, `task_id`, `comment_id` | |
| `labels_changed` | (none) | an organization label is created, renamed, recolored or deleted |
| `project_access_changed` | `project_id` | a project's visibility or people change; every client refreshes it, and a socket reloads its hidden set first |
| `notification` | `user_ids` | those users have new notifications (`docs/notifications.md`). Ids only, never content; each client fetches its own |

Project and member changes other than access (renames, role changes) are not pushed; clients see
them on their next load.

## Limits and backpressure

| Setting | Default | What happens |
| --- | --- | --- |
| `WS_MAX_CONNECTIONS` | 10,000 per API pod | Further sockets are refused with **1013** (try again later). The web client retries with backoff and may reach another pod. |
| `WS_MAX_CONNECTIONS_PER_USER` | 20 per user per pod | A further socket is refused with **1008** (`Too many connections`), so a runaway script does not retry in a loop. |
| `WS_MAX_BUFFERED_BYTES` | 1 MiB | A socket with more unsent data than this, or more than 1,000 events waiting to be handled, is closed with **1013** (`Too slow`). The client reconnects and refetches. A slow client never grows the server's memory without bound. |

Each refusal is counted in `websocket_rejections_total{reason}` (`pod_full`, `too_many_for_user`,
`slow_consumer`, plus `origin`, `unauthorized`, `revoked`, `client_message`, `subscription_failed`).
`active_websocket_connections` is the gauge. Load-tested: 1,000 sockets with every event delivered
(`docs/load-testing.md`).

## What Redis holds

| Use | Keys / channels | Lifetime |
| --- | --- | --- |
| Live events | channel `org:<id>:updates` | pub/sub, not stored |
| Board cache | `org:<id>:project:<id>:tasks` | 60 s; deleted on every change to the board |
| Project list cache | `org:<id>:projects` | 300 s; deleted on project changes |
| Rate limits | `openpm:rate-limit:*` | the limit's window; shared by every API pod |
| Job queue (BullMQ) | `bull:tasks:*` | until done; completed jobs kept 24 h, failed 7 days (`docs/jobs.md`) |

Redis runs with **`maxmemory-policy noeviction`**, set explicitly in Compose and the Helm chart.
Evicting a key could silently drop a queued job. In Kubernetes `maxmemory` (`redis.maxMemory`,
200 MB) sits below the container's memory limit, so a full Redis refuses writes before it is
OOM-killed. Failed enqueues are counted in `jobs_enqueue_failed_total` and alerted on.

The cache is optional: if Redis is down, reads go to Postgres, writes skip the cache, and
invalidations are replayed when it is back (`cache_bypassed_total`). Live events stop until it
returns.
