# The API

Base path `/api`, JSON in and out. The full list of routes, with every parameter and body, is
**[openapi.json](openapi.json)** (OpenAPI 3). It is generated from the routes' own validation
schemas, so it cannot drift from what the API accepts: a test fails when the committed copy is
stale (`UPDATE_OPENAPI=1 npm test` in `apps/api` rewrites it). Outside production, Swagger UI serves
the same spec at `/docs`.

## Authentication

| | |
| --- | --- |
| **Sign in** | `POST /api/auth/login` `{ email, password, as? }` sets an httpOnly `auth_token` cookie (SameSite=Strict, Secure in production) and returns `{ token, role }`. `as` is `member` (the default) or `admin`: the admin sign-in lets in only owners and admins, and answers anyone else (with the right password) `403` without a session. Sign-up and invite acceptance sign you in the same way. |
| **Send it** | Browsers send the cookie automatically. Other clients send `Authorization: Bearer <token>`. Tokens in the URL are never accepted. |
| **Lifetime** | 24 hours. There is no refresh token: sign in again. |
| **Every request** | The token's signature and expiry are checked, and then the session itself: the user still exists and is active, and `token_version` still matches. So a demotion, a removal or a revoked session takes effect on the next request, not when the token expires. The current role always comes from the database. |
| **Ending sessions** | `POST /api/auth/logout`, changing the password (which needs the current one) and a password reset end **every** session of that user on every device. Live sockets close at their next heartbeat. |
| **CSRF** | The cookie is SameSite=Strict, and the only allowed origin for credentialed CORS is `CORS_ORIGIN`. The WebSocket checks `Origin` too. |
| **Roles** | owner > admin > member > viewer, per organization. Viewers read, members write, admins delete and manage people (`docs/security-model.md`). Private projects add per-project membership (`docs/projects.md`). |

Sign-up may be verified by email first (`docs/signup.md`). Failed sign-ins and password changes are
in the security audit log (`docs/audit-log.md`). Nothing in any response says whether an email
address has an account.

## Requests

- **Validation:** every route that takes a body, query string or path parameter declares a JSON
  Schema. Unknown keys are **refused** (400), not ignored, so a typo never silently does nothing.
  Path ids must be UUIDs (400 otherwise), and text containing NUL bytes is refused. The OpenAPI
  test holds every route to these rules.
- **Tenancy:** the organization always comes from your session, never from the request. An id from
  another organization, or a private project you cannot see, answers **404**, exactly like an id
  that does not exist.
- **Lists:** keyset pagination, `{ items, next_cursor }` with `?limit` (up to 100) and `?cursor`
  (`docs/pagination.md`).
- **Concurrent edits:** a task `PATCH` may send the `version` it is based on; a stale one gets 409
  with the current task (`docs/concurrency.md`).
- **Live updates:** `GET /ws` (`docs/realtime.md`).

## Responses and errors

Every error has the same shape, `{ "error": "<message>" }`. A few add fields (a 409 for a stale
task also carries `task`).

| Status | Meaning |
| --- | --- |
| 400 | The request is invalid (`Invalid request: ...` names the field). |
| 401 | Not signed in, or the session has ended. The web app signs out and goes to `/login`. |
| 403 | Signed in but not allowed (role too low, wrong current password). |
| 404 | Not found **or not yours to see**; the two are indistinguishable on purpose. |
| 409 | Conflicts with the current state: a duplicate, a stale version, a limit reached. |
| 422 | An uploaded file does not match what was declared (`docs/attachments.md`). |
| 429 | Rate limited; `Retry-After` says when to try again. |
| 503 | Overloaded or a dependency is down; `Retry-After` is set. Safe to retry. |
| 500 | A bug. The body says only "Internal server error"; quote the `X-Request-Id` response header to find the log line. |

Every response carries `X-Request-Id` (send your own to correlate; `docs/observability.md`).

## Rate limits

Per client address, shared across API pods (Redis). Behind a proxy, set `TRUST_PROXY` so the address
is the client's (`docs/deploying.md`).

| Route | Limit per minute |
| --- | --- |
| everything under `/api` (default) | 100 |
| `POST /auth/register`, `/auth/login`, `/auth/verify-signup`, `/auth/reset-password` | 10 |
| `POST /auth/forgot-password` | 5 |
| `POST /invites/lookup` | 20 |
| `POST /invites/accept`, `/invites/decline` | 10 |
| `PATCH /profile/me` | 10 |
| `DELETE /organization` | 5 |
| `/health`, `/health/live`, `/metrics` | none (not exposed by the Ingress; Kubernetes probes share one address per node) |

## Adding a route

The API is layered (`apps/api/src`):

1. **`routes/`**: the JSON Schema for the body, query and params (with `additionalProperties:
   false`), the role (`preHandler: fastify.requireRole('member')`), and one call to a service. The
   handler builds the scope with `scopeOf(request.user)` and picks the status code. Nothing else.
2. **`services/`**: the rules. Transactions (`withTransaction`), checks that throw the typed errors in
   `domain/errors.ts` (their status becomes the response), activity and audit entries, cache
   invalidation and events after the commit, jobs to queue.
3. **`data/`**: all SQL. Every function takes the `TenantScope` and filters by its organization,
   joins included. Inside a transaction it takes the client.

Then:

- **Tests:** a unit test next to the route (`routes/*.test.ts`, database mocked), and an integration
  test against real Postgres (`test/integration/*.int.test.ts`) for anything with SQL, including a
  cross-organization case that must answer 404.
- **The spec:** run `UPDATE_OPENAPI=1 npm test` and commit `docs/openapi.json`.
- **Schema changes:** a new numbered migration with its `.down.sql`. Integration runs apply every
  migration, roll all of them back and apply them again. A new foreign key's `ON DELETE` rule goes
  into `deletion.int.test.ts` (`docs/data-deletion.md`).
- **Events and jobs:** a new event type is documented in `docs/realtime.md`; a new job in
  `docs/jobs.md`, with a processor in `apps/worker/src/processors/`, a branch in `handler.ts`, and
  its name in `metrics.ts`.

## The worker

`apps/worker` takes jobs from the BullMQ queue `tasks` (`docs/jobs.md`: every job, retries,
idempotency, recovery) and runs two scheduled sweeps (due-date reminders, notification cleanup).
Its environment is validated at startup (`apps/worker/src/config.ts`). A processor looks up
everything by the job's `org_id`, checks that what it is about to send still makes sense (the link
still works, the person is still a member), and is tested both in isolation (`processors/*.test.ts`)
and against real Postgres with the jobs the real API queues (`workerJobs.int.test.ts`).
