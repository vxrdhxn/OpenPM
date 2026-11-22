# Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. All jobs run in
parallel with read-only repository access (`permissions: contents: read`), and a new push to a pull
request cancels that PR's older run.

| Job | What it checks | Blocks merge? |
|---|---|---|
| **Lint, build, test** | `npm ci` (lockfile must match every `package.json`), `npm audit --audit-level=high` (known high or critical vulnerabilities in any dependency, dev included), `npm run lint`, `npm run build` (API, worker and frontend; also the type-check), `npm test` (every package, then the cross-package dashboard check) | Yes |
| **Integration tests (Postgres)** | `npm run test:integration` against a Postgres service container: creates a throwaway database, runs every migration up, down to an empty schema and up again, then drives the real API (routes, auth, SQL) for tenant isolation, roles, account flows (register, password reset, invites) and rate limits. Redis and the job queue are in-memory fakes. The API connects as a least-privilege user created the way `migrate up` creates it in production | Yes |
| **Helm chart** | `helm lint --strict` and `helm template` for default values, `values.prod.yaml`, and monitoring + dashboards + alert rules enabled; `promtool check rules` and `promtool test rules` on the alert rules (promtool from the Prometheus image, pinned by digest) | Yes |
| **Secret scan (gitleaks)** | Whole git history against `.gitleaks.toml`, plus a canary that proves the config still detects secrets | Yes |
| **Image (api / worker / frontend)** | Builds each Dockerfile from a clean checkout, then scans the image with Trivy (HIGH/CRITICAL, fixable only) | Yes (build and scan) |

Note that jobs only gate merging once you mark them as **required status checks** in the repository's
branch protection settings. The workflow cannot do that itself; see [Branch protection](#branch-protection).

## Image vulnerability scanning is blocking

`TRIVY_EXIT_CODE` at the top of the workflow is `"1"`, so a fixable HIGH/CRITICAL finding in any
image fails its job. It was report-only until the November 2026 upgrades (Node 22, Fastify 5,
Next 16, Zod 4, ...) cleared the backlog; `npm audit --omit=dev` has reported 0 vulnerabilities since.

The first blocking run failed all three images on advisories in the **npm CLI bundled with
`node:22-alpine`**, not in OpenPM's dependencies. Nothing runs npm inside the containers (Compose,
Helm and the probes call `node` directly), so each runtime stage deletes npm, yarn and corepack. Do
not add an `npm run ...` command to a container; call `node` on the built file instead.

When a new advisory fails the build:

1. Prefer the fix: bump the package (or rebuild to pick up a patched `node:22-alpine`).
2. If it cannot be fixed yet and is not exploitable here, add its ID to a `.trivyignore` file at the
   repository root with a comment saying why and when to revisit it.
3. Do not set `TRIVY_EXIT_CODE` back to `"0"`; that silences every future finding too.

## Branch protection

CI ran green on GitHub for the first time on 2026-11-15 (every job, every commit since). To make it
gate merges, in **Settings → Branches → Add branch protection rule** (or a ruleset) for `main`:

- Require a pull request before merging (1 approval if there is more than one maintainer).
- Require status checks to pass, and require branches to be up to date. Select these checks:
  `Lint, build, test`, `Integration tests (Postgres)`, `Helm chart`, `Secret scan (gitleaks)`,
  `Image (api)`, `Image (worker)`, `Image (frontend)`, `Browser tests (Playwright)`, `CodeQL (javascript-typescript)`,
  `CodeQL (actions)`.
- Require conversation resolution before merging.
- Block force pushes and deletions.

A check name only appears in the picker after it has run once on the repository.

## CodeQL (static analysis)

`.github/workflows/codeql.yml` runs on every pull request, on pushes to `main` and weekly (new queries
also reach unchanged code). It is a separate workflow because uploading results needs
`security-events: write`, which the main CI does not get.

- **Languages:** `javascript-typescript` (API, worker, frontend; no build needed) and `actions` (the
  workflows themselves: script injection through untrusted inputs, over-broad permissions, ...).
- **Queries:** `security-extended` (the default suite plus lower-precision security queries).
  Build output (`dist/`, `.next/`) is excluded.
- **Results** appear under **Security → Code scanning**, and on pull requests as annotations.

The CodeQL job fails only if the analysis itself fails, not when it finds something. Findings block
merges through a **code scanning** rule in the `main` ruleset (**Settings → Rules → Rulesets → main**):
tool CodeQL, blocking on *High or higher* security alerts and on *Errors* for other alerts. It is
checked on pull requests; a new finding at that level must be fixed or dismissed before merging.

To triage a finding: fix it, or dismiss it in the Code scanning UI with a reason (false positive,
used in tests, won't fix). Do not delete queries or add `paths-ignore` entries to hide one.

## Secret scanning

- `.gitleaks.toml` **extends gitleaks' built-in rules** (`useDefault = true`) and adds OpenPM-specific
  ones. Before this was fixed, the config replaced the built-ins and a private key went undetected.
- Allowlists cover only the placeholders this repo ships on purpose (local dev credentials,
  `SECRET_..._HERE`, `${VAR}` references, Helm `printf` format strings) and are anchored to the
  password position, so a real secret next to a placeholder is still reported.
- The **canary** step writes fake secrets at run time and requires gitleaks to report them. If someone
  loosens the config until it detects nothing, CI fails instead of passing silently.
- The gitleaks binary is a pinned release, verified against its published SHA-256 before it runs.

Run it locally: `gitleaks detect --source . --config .gitleaks.toml --redact`

## Supply chain

- Every third-party action is pinned to a **commit SHA** (the version is in a comment), so a moved tag
  cannot change what runs. Dependabot (`.github/dependabot.yml`) opens weekly grouped PRs for actions,
  npm packages and Docker base images.
- When bumping an action, check that the inputs used in `ci.yml` still exist in the new version's
  `action.yml`.

## What was and was not verified

Verified locally, with the same commands the workflow runs: `npm ci --dry-run` (lockfile in sync,
including the Linux native binaries), the builder stage of the worker Dockerfile, `helm lint --strict`
and `helm template` for all three variants, the gitleaks canary and history scan (including a
negative control), YAML parsing, SHA-pin checks, that every `with:` input exists in each pinned
action, `actionlint` (clean), and the integration suite against Postgres 16 in Docker.

On GitHub, every job has passed on every push to `main` since 2026-11-15, including the Trivy scans.

**Not verified:**

- Some API tests are timing-based (heartbeat and token-expiry tests use short real timers); a heavily
  loaded runner could make one flaky.
- `dist/` currently also contains compiled `*.test.js` files, so images ship them. Excluding tests
  from the build `tsconfig` would slim the images but would stop `tsc` type-checking the tests.

## Release workflow

`.github/workflows/release.yml` runs when a `vX.Y.Z` tag is pushed. It publishes the images to GHCR,
creates the GitHub Release and opens the production deploy PR. It runs only for a commit on `main`
whose CI checks above passed. Process, permissions and one-time setup: [releasing.md](releasing.md).

