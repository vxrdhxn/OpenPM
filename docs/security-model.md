# Security model

How OpenPM decides who someone is, what they may see and do, and what keeps one organization's data
apart from another's. [threat-model.md](threat-model.md) lists what could go wrong and how each
threat is handled; [security-review.md](security-review.md) is the v0.1.0 review.

## Architecture and trust boundaries

```text
 browser ──HTTPS──> Ingress ──> frontend (Next.js: pages only, no data)
    │                  └──────> API (Fastify) ──> Postgres   (app user: rows only)
    │                              │  │  └──────> Redis      (cache, pub/sub, rate limits, queue)
    │                              │  └─────────> object storage (presigns URLs; never proxies bytes)
    └── presigned PUT/GET ─────────┼────────────> object storage
                                   └─ queue ─> worker ──> Postgres, email provider
```

- **The browser is untrusted.** Every check happens in the API; the UI only hides what the API
  would refuse anyway.
- **The API is the only way to the data.** Postgres and Redis are reachable only from the API,
  worker and migration step (default-deny NetworkPolicies; Compose binds them to `127.0.0.1`).
- **The frontend server holds no secrets** and makes no API calls; it serves pages and sets their
  security headers (`src/proxy.ts`).
- **The worker trusts only what it re-reads.** Jobs carry ids; the worker looks the rows up again,
  scoped to the job's organization, and rejects malformed payloads without retrying (`docs/jobs.md`).

## Authentication

- **Passwords:** bcrypt, cost 12, at least 8 characters. Sign-in compares against a dummy hash for
  unknown emails, so timing does not reveal which emails have accounts.
- **Sessions:** an HS256 JWT signed with `JWT_SECRET` (32+ characters, required in production;
  published example secrets are refused), in an `httpOnly`, `SameSite=Strict`, `Secure` (production)
  cookie, valid 24 hours. Non-browser clients may send it as `Authorization: Bearer`; never in a URL.
- **Every request re-checks the session** against the database: the user still exists and is
  active, their `token_version` still matches, and their role is read fresh. Sign-out (on every
  device), a password change or reset, and removal from the workspace end all sessions at once,
  open WebSockets included (closed at the next heartbeat, 30 s).
- **Password reset:** a single-use, 1-hour link. Only its SHA-256 hash is stored; requesting a new
  one invalidates the old one.
- **Rate limits** (per client address, shared by all API pods through Redis): 100 requests a minute
  overall; sign-in and sign-up 10, forgot-password 5, reset 10, invite lookup 20 and accept 10.
- **Audited:** sign-ins, failed sign-ins for existing accounts, sign-outs, password changes and
  resets ([audit-log.md](audit-log.md)).

Not provided: multi-factor authentication, account lockout, single sign-on. Sign-up does not reveal
whether an email is registered when verify-by-email is on ([signup.md](signup.md); the default
whenever an email provider is configured). With `SIGNUP_VERIFICATION=off`, or no email provider, it
still fails where a new address would succeed.

## Authorization

Roles, highest first: **owner > admin > member > viewer**. The role is read from the database on
every request, never from the token alone.

| Area | Viewer | Member | Admin | Owner |
| --- | --- | --- | --- | --- |
| See projects, tasks, comments, attachments, labels, dashboard, activity | ✓ | ✓ | ✓ | ✓ |
| Search tasks; own notifications and profile | ✓ | ✓ | ✓ | ✓ |
| Create and edit projects, tasks, labels; comment; upload | | ✓ | ✓ | ✓ |
| Add people to a private project; remove them | | ✓ | ✓ | ✓ |
| Leave a project or the workspace | ✓ | ✓ | ✓ | ✓ |
| Edit or delete **your own** comment / delete **your own** attachment | | ✓ | ✓ | ✓ |
| Delete **anyone's** comment or attachment; delete tasks, projects, labels | | | ✓ | ✓ |
| Invite, change roles, remove members (below your own role) | | | ✓ | ✓ |
| Rename the workspace; read the security log | | | ✓ | ✓ |
| Transfer ownership; delete the workspace (slug and password required) | | | | ✓ |

Rules beyond the role:

- **Private projects** ([projects.md](projects.md)) are visible only to the people added to them and
  to admins and owners. Everyone else gets `404 Project not found` for every route under the project,
  from one gate in `app.ts`; workspace-wide reads (lists, search, dashboard, activity,
  notifications, live events) filter them out. Only admins, owners and the project's creator can
  change a project's visibility.
- **Membership rules** ([members.md](members.md)): you can only manage people below your own role,
  never grant a role above your own, and the workspace always keeps an owner.
- **Assignees and mentions** must be able to see the project.

The exact role for each route is the `requireRole(...)` on it in `apps/api/src/routes`; the table
above summarizes them. `routes/security_rbac.test.ts` and the integration suite test the boundaries.

## Tenant isolation

- The organization always comes from the verified session (`request.user.org_id`), never from the
  request. No URL or body names an organization.
- Every query is scoped by `org_id`: rows are read and changed only `WHERE … AND org_id = $n`, and
  nested resources are checked through their parents (attachment → task → project → organization).
  Statements without an `org_id` filter run only after an org-scoped ownership check in the same
  transaction.
- Ids are UUIDs; anything else is a 400 before a query runs. A row from another organization is a
  404, the same answer as a row that does not exist.
- Live events go to an organization's own channel, `org:<org_id>:updates`, chosen from the session;
  clients cannot subscribe to anything (the socket accepts no messages at all).
- Caches are keyed by organization; object-storage keys are random and recorded per organization.
- `test/integration/tenantIsolation.int.test.ts`: an admin of one organization attacks another's resources by id; every attempt must fail as if they did not exist, and nothing may change.

## Input handling

- JSON Schema on every route: unknown keys rejected, types and lengths checked, ids must be UUIDs.
  1 MB body limit, 30 s to send a request.
- No NUL characters in any text (Postgres cannot store them; `plugins/textInput.ts`). A value
  Postgres rejects anyway is a 400, never a 500.
- SQL is parameterized; the few dynamic column names come from fixed allow-lists.
- Text is stored and shown as plain text: React escapes it, and nothing uses
  `dangerouslySetInnerHTML`.
- Uploads: an allow-list of types, checked against the file's first bytes after upload; size
  limits; downloads are always served as attachments, never rendered inline.
- The WebSocket accepts no client messages: any message closes it (1008), and frames over 4 KiB are
  refused before that.
- `test/integration/maliciousInput.int.test.ts` sends SQL, HTML, NUL bytes, prototype-pollution
  keys, deep nesting, oversized and malformed bodies.

## Browser protections

Every page gets a **Content-Security-Policy** with a fresh nonce per request (`src/lib/csp.ts`,
`src/proxy.ts`):

```text
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' <api> <socket> <storage>;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Only scripts carrying the nonce run. Injected markup cannot run code: inline event handlers and
`<script>` tags without the nonce are blocked (a browser test injects one). Inline *styles* are
allowed (React and the drag-and-drop library set them); styles cannot run code. Every page is
rendered per request, since a page built in advance would carry no nonce. Uploads go straight from
the browser to object storage, so its origin must be in `CSP_CONNECT_SRC` (Helm:
`frontend.cspConnectSrc`) or uploads are blocked.

Also on every response: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` turning off camera,
microphone and location, and no `X-Powered-By`. The API's CORS allows exactly one origin
(`CORS_ORIGIN`), and the WebSocket checks the handshake's `Origin`.

## Secrets

No default credentials anywhere: Compose refuses to start without `JWT_SECRET` and
`DATABASE_APP_PASSWORD`, and the Helm chart refuses to render without its secrets.
[deploying.md](deploying.md) covers creating and rotating them. The database is reached with a
least-privilege user ([database-access.md](database-access.md)). Logs redact credentials and
tokens. gitleaks scans the history in CI.

## Security assumptions

OpenPM relies on these, and does not protect against them failing:

- **TLS terminates at the Ingress** (or another proxy in front of the frontend and API). Without
  it, session cookies cross the network in clear text.
- **`TRUST_PROXY` matches the deployment.** Behind exactly one proxy, `1`; reached directly, unset.
  Wrong, clients can choose their own address for rate limits and the audit log.
- **Postgres, Redis and object storage are private.** Traffic to them inside the cluster is not
  encrypted; NetworkPolicies decide who can connect. For a managed database, add
  `sslmode=require` to `DATABASE_URL`.
- **Whoever can read the Kubernetes Secret or `.env` owns the system.** `JWT_SECRET` signs every
  session.
- **The email account that receives a reset link is the user's.** Email is the only second channel.
- **Admins are trusted** within their workspace. They see every project and the security log.
- **Redis is trusted.** Rate limits and live events depend on it; when it is down, rate limiting is
  off (requests are allowed) rather than the API.
