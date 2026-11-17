# Security review (v0.1.0)

Pre-release review, 2026-11-17: the code, the Helm chart, Compose and the CI gates, read with one
question: what would let someone into data that is not theirs?

## Fixed in this review

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| 1 | **The Helm chart's default `jwtSecret` was a value published in this repository**, and `global.environment` defaults to `production`. `values.prod.yaml` did not override it, and the Argo CD apps had no way to supply secrets except through Git. | A default or Argo CD install signs sessions with a public key. Anyone could create a token for any user in any workspace: full takeover. | The chart has no default credentials and refuses to render without them (a 32+ character JWT secret, plus Postgres and Redis passwords when in-chart). New `secrets.existingSecret` reads credentials from a Secret created outside Git; `values.prod.yaml` and both Argo CD apps use it. Chart tests cover each refusal. |
| 2 | **`docker-compose.yml` had a built-in `JWT_SECRET`** and runs with `NODE_ENV=production`, so the API's "secret required in production" check passed. | Same as 1 for every Compose install that did not set its own. | Compose requires `JWT_SECRET` from `.env` and fails with how to make one. The API now refuses, in production, every example secret ever published here (`.env.example`, old Compose and chart defaults). Unit-tested. |
| 3 | Compose published Postgres (5432) and Redis (6379) on every interface, with the passwords `openpm`. | Anyone on the network could read or change the database. | Both bind to `127.0.0.1`. |
| 4 | **Behind the Ingress, every request came from the controller's address.** The API didn't trust `X-Forwarded-For`. | The rate limit (100 a minute; less for sign-in) was shared by all users together: one busy client, or a password-guessing run, locked everyone out. | `TRUST_PROXY` (hop count or proxy addresses), off by default so direct clients cannot spoof their address. The chart sets `api.trustProxy: "1"`. |
| 5 | The frontend sent no framing or content-type headers and advertised `X-Powered-By: Next.js`. | Clickjacking: another site could frame the app and trick a click (e.g. a delete confirmation). | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and a permissions policy on every page. A browser test checks them. |
| 6 | **Rate limits were counted separately in each API pod.** Found while testing finding 4 on kind: with 2 pods a client got 200 requests a minute, not 100. | Brute-force protection weakened by the pod count: with the HPA's maximum of 10 pods, "10 sign-in attempts a minute" was 100. | Counters live in Redis, shared by every pod. If Redis is unreachable, requests are allowed rather than failed or delayed, like the cache. Integration tests run two app instances against a real Redis; CI now starts one. |
| 7 | The chart built `DATABASE_URL`/`REDIS_URL` from passwords without URL-encoding. | A password containing `@`, `/` or `:` broke the connection string (availability; it pushed people towards weak passwords). | Passwords are URL-encoded. Tested. |

Upgrading an install that used the old defaults: rotate the secrets, as
[deploying.md](deploying.md#upgrading-an-install-made-with-the-old-defaults) describes.

## Checked, no change needed

- **Tenant isolation.** Every SQL statement in the routes was listed. Those that do not filter by
  `org_id` run only after an org-scoped ownership check in the same transaction (e.g. labels lock
  the task `WHERE id AND project_id AND org_id` first). The org comes from the verified token, never
  from the request. `security_rbac.test.ts` and the integration suite cover cross-tenant access.
- **Sessions.** HS256 JWT in an httpOnly, `SameSite=Strict`, `Secure` (production) cookie, 24 h.
  Every request re-reads the user's role and `token_version`, so removal, deactivation, role
  changes and password changes take effect at once, including on open WebSockets.
- **Input.** Parameterised SQL throughout. JSON Schema on routes, `additionalProperties: false`,
  non-UUID ids rejected with 400, a 1 MB body limit and a 30 s request timeout.
- **Errors.** 5xx bodies carry no internal messages; logs redact credentials (tested).
- **Attachments.** Presigned URLs are short-lived and issued only after a permission check; the API
  never proxies file bytes. Without storage configured the endpoints return 503; there are no
  default storage credentials.
- **Dependencies.** `npm audit`: 0 vulnerabilities, production and development. Trivy blocks fixable
  HIGH/CRITICAL findings in the images; CodeQL runs on every PR; gitleaks scans the history.
- **Kubernetes.** Non-root, read-only root filesystems, all capabilities dropped, seccomp
  `RuntimeDefault`. Default-deny NetworkPolicies; only the Ingress reaches the API and frontend.

## Known limits (accepted for v0.1.0)

- **No full Content-Security-Policy** on the frontend; Next.js needs per-request nonces for one.
  `frame-ancestors` is set. An XSS bug would not be contained by a CSP. React escapes output and
  there is no `dangerouslySetInnerHTML`, but there is no CSP as a backstop.
- **Tokens are bearer tokens for 24 hours.** Revocation is immediate (token version), but a stolen
  cookie works until then unless the user changes their password or is removed.
- **No account lockout or MFA.** Sign-in is rate-limited per address only, and not at all while
  Redis is down (the limiter allows requests rather than failing them).
- **Postgres and Redis traffic inside the cluster is not TLS.** NetworkPolicies restrict who can
  connect. For a managed database, put `sslmode=require` in `DATABASE_URL`.
- **No audit** of code-scanning, Dependabot or secret-scanning alerts on GitHub in this review: they
  need an authenticated `gh`, which was not available. Check the repository's Security tab before
  tagging (it is on the [release checklist](release-checklist.md)).

Report vulnerabilities privately: [SECURITY.md](../SECURITY.md).
