# Threat model

What an attacker could want from an OpenPM install, how they might get it, and what stops them.
Written for v0.1.x; review it when a feature adds a new way in (a new kind of input, a new external
service, a new role). [security-model.md](security-model.md) describes the controls referred to here.

## Assets

| Asset | Why it matters |
| --- | --- |
| Organization data: projects, tasks, comments, labels, files | The product. Confidential to its workspace, and private projects within it. |
| User accounts and sessions | A session is everything that user can do. |
| `JWT_SECRET` | Signs every session: whoever has it can sign in as anyone. |
| Database and its credentials | All data of all organizations. |
| Redis | Rate limits, the job queue (holds reset tokens until the email is sent), live events. |
| Object storage and its keys | Every attachment. |
| Kubernetes Secrets, `.env` | All of the above. |
| The security audit log | Evidence after an incident. |

## Attackers

- **Outsider** on the internet: no account. Can reach the sign-in pages and the API.
- **Member of another workspace:** a valid session, aimed at someone else's data.
- **Insider:** a viewer or member of the workspace, aimed at more than their role allows (private
  projects, admin actions).
- **Someone with a stolen session**, for example a cookie copied off a shared computer.
- **Supply chain:** a compromised npm package or base image.
- **Someone in the cluster or on the host:** a compromised pod, or a leaked kubeconfig.

## Threats

Likelihood is for an internet-facing install. Impact and likelihood are each rated high, medium or
low.

| # | Threat | Impact | Likelihood | Mitigation | Detection | Tested by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Account takeover** by password guessing or credential stuffing | High | Medium | bcrypt cost 12; 10 sign-ins a minute per address, counted across pods; uniform answers and timing for unknown emails; reset links single-use, 1 hour, stored hashed | `auth.login_failed` in the security log; `auth_failures_total`; alert `OpenPMLoginFailuresHigh` | `rateLimit.int.test.ts`, `rateLimitShared.int.test.ts`, `auth.test.ts`, `auditLog.int.test.ts` |
| 2 | **Session (JWT) theft** and replay | High | Low | `httpOnly`, `SameSite=Strict`, `Secure` cookie; never in URLs or logs; a CSP with nonces blocks injected scripts; 24 h lifetime; sign-out and password changes end every session | `auth.login` entries with an unfamiliar IP or device | `auth.session.test.ts`, `sessions.int.test.ts`, `logger.test.ts`, `login.spec.ts` (CSP) |
| 3 | **Forged tokens**: algorithm confusion, a guessed or published secret | High | Low | HS256 with a 32+ character secret; unsigned, RS256 and HS512 tokens rejected; published example secrets refused in production; the chart and Compose have no default | 401s in `http_requests_total` | `auth.session.test.ts`, `config.test.ts`, `tests/helm` |
| 4 | **IDOR/BOLA**: reading or changing a row by guessing its id | High | Medium | Every query scoped by `org_id` from the session; nested resources checked through their parents; UUIDs only; other organizations' rows are 404 | 404 rates | `tenantIsolation.int.test.ts`, `security_rbac.test.ts` |
| 5 | **Cross-tenant access** through shared parts: cache, live events, search, files | High | Low | Cache keys and the event channel include the session's `org_id`; the socket accepts no subscriptions; storage keys are random and checked against the row | — | `tenantIsolation.int.test.ts`, `websocket.test.ts` |
| 6 | **Privilege escalation**: a viewer acting as a member, a member as an admin, anyone into a private project | High | Medium | Role re-read from the database on every request; `requireRole` on every route; you can only manage people below your role; profile updates reject `role`/`org_id`; one gate for private projects | `member.role_changed` entries in the security log | `security_rbac.test.ts`, `members.int.test.ts`, `projectAccess.int.test.ts`, `projectGate.test.ts` |
| 7 | **Malicious file upload**: malware, HTML/SVG that runs as the site, oversized files | Medium | Medium | Type allow-list checked against the file's first bytes; size limits; files served from the storage origin as downloads only, never inline; presigned URLs expire in 2–5 minutes | Rejected uploads in the API log | `attachments.test.ts`, `policy.test.ts` |
| 8 | **Injection**: SQL, XSS, header or log injection | High | Low | Parameterized SQL, fixed column allow-lists; text rendered escaped by React; a nonce-based CSP as a backstop; JSON logs; NUL bytes refused | 400 and 500 rates; CSP violations in browser consoles | `maliciousInput.int.test.ts`, `login.spec.ts` |
| 9 | **WebSocket abuse**: hijacking from another site, subscribing to other channels, flooding | Medium | Low | Origin checked on the handshake; session required and re-checked every 30 s; channel chosen from the session; client messages close the socket; 4 KiB frame limit | `websocket_rejections_total` by reason; `OpenPMWebsocketErrors` | `websocket.test.ts` |
| 10 | **Queue poisoning**: a crafted job makes the worker act for the wrong organization or email the wrong person | Medium | Low | Only the API enqueues (Redis has a password and NetworkPolicy); jobs carry ids, and the worker re-reads rows scoped to the job's organization; malformed jobs fail without retrying | `OpenPMJobsFailing`; the worker's job log | `handler.test.ts`, processor tests |
| 11 | **Redis compromise** | Medium | Low | Password, private network; holds no passwords; reset tokens live only until the email is sent; losing it turns rate limiting off rather than letting anyone in | `OpenPMRedisErrors` | `redisOutage.int.test.ts` |
| 12 | **Database compromise**, including through an SQL injection bug | High | Low | Private network; the app's user can change rows but not the schema, the migration history or the audit log; tested backups | `OpenPMDbQueryErrors` | `databaseAccess.int.test.ts`, `scripts/test-backup-restore.sh` |
| 13 | **Secret leakage** through the repository, images or logs | High | Medium | No secrets in Git (gitleaks in CI, on all history); `existingSecret` keeps them out of Argo CD; images contain no `.env`; logs redact credentials and tokens | gitleaks findings fail CI | `.github/workflows/ci.yml` (gitleaks), `logger.test.ts`, `tests/helm` |
| 14 | **Denial of service** | Medium | Medium | Rate limits (shared through Redis); 1 MB bodies; 30 s request timeout; 10 s statement timeout; bounded pages; a full pool answers 503 with Retry-After; HPA and PDBs | `OpenPMApiOverloaded`, `OpenPMApiRateLimiting`, `OpenPMDbPoolExhausted`, latency alerts | `docs/load-testing.md` (failure tests), `rateLimit.int.test.ts` |
| 15 | **Supply-chain compromise** | High | Low | Locked dependencies (`npm ci`); `npm audit` blocks high and critical in CI; Dependabot; Trivy blocks fixable high and critical in images; CodeQL; GitHub Actions pinned by commit. Base images (`node:22-alpine`) follow a tag, not a digest | CI failures; Dependabot and code-scanning alerts | `.github/workflows/ci.yml` |
| 16 | **Insider abuse by an admin**: reading private projects, quietly changing roles | Medium | Low | Admins are trusted by design and see every project; role, membership and access changes are in the security log, which the app cannot edit | The security log | `auditLog.int.test.ts` |

## Residual risks

Accepted, with what would change them:

- **No MFA or account lockout.** Guessing is slowed per address, not per account: a distributed
  guessing run is limited only by bcrypt and the global rate limit. MFA would close it.
- **Sign-up reveals whether an email is registered** (threat 1). Verify-by-email sign-up would close
  it.
- **A stolen session works for up to 24 hours** unless the user signs out or changes their password
  (threat 2). Shorter sessions with refresh would reduce it.
- **No malware scanning** of uploads (threat 7). Files are only ever downloaded, never opened by
  OpenPM, but a member could still share a malicious file with colleagues.
- **Traffic inside the cluster is not encrypted** (threats 11, 12). It relies on NetworkPolicies.
- **Rate limiting is off while Redis is down** (threats 1, 14): a deliberate choice of availability
  over brute-force protection during an outage.
- **Workspace deletion deletes its audit log** (threat 16); one line remains in the API log.
