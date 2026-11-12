# Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. All jobs run in
parallel with read-only repository access (`permissions: contents: read`), and a new push to a pull
request cancels that PR's older run.

| Job | What it checks | Blocks merge? |
|---|---|---|
| **Lint, build, test** | `npm ci` (lockfile must match every `package.json`), `npm run lint`, `npm run build` (API, worker and frontend; also the type-check), `npm test` (every package, then the cross-package dashboard check) | Yes |
| **Helm chart** | `helm lint --strict` and `helm template` for default values, `values.prod.yaml`, and monitoring + dashboards enabled | Yes |
| **Secret scan (gitleaks)** | Whole git history against `.gitleaks.toml`, plus a canary that proves the config still detects secrets | Yes |
| **Image (api / worker / frontend)** | Builds each Dockerfile from a clean checkout, then scans the image with Trivy (HIGH/CRITICAL, fixable only) | Build: yes. Scan: **no, report-only** (see below) |

Note that jobs only gate merging once you mark them as **required status checks** in the repository's
branch protection settings. The workflow cannot do that itself.

## Image vulnerability scanning is report-only (for now)

`TRIVY_EXIT_CODE` at the top of the workflow is `"0"`, so Trivy prints findings but does not fail the
build. The dependency tree currently has known HIGH/CRITICAL advisories, and several can only be
fixed by major upgrades, so a blocking scan would fail every build for reasons unrelated to the change.

As of 2026-11-12, `npm audit --omit=dev` reported **4 critical and 12 high** advisories in production
dependencies. The notable ones:

| Package | Advisory (summary) | Fix |
|---|---|---|
| `fast-jwt` (via `@fastify/jwt`) | Improper validation of `iss` claims | Major upgrade |
| `next` 14.x | Self-hosted DoS via the image optimizer | Major upgrade |
| `fastify` 4.x | DoS via unbounded memory in `sendWebStream` | Major upgrade (v5) |
| `proxy-addr` | IP spoofing via IPv4-mapped IPv6 trust subnet | Non-breaking update available |
| `tar` (build-time, via `bcrypt`) | Arbitrary file write via hardlink traversal | Non-breaking update available |
| `zod` 3.x | Memory exhaustion on oversized collections | Major upgrade (v4) |
| `ws`, `nanoid`, `brace-expansion`, `fast-uri` | DoS-class issues | Non-breaking updates available |

Whether each is **exploitable here** has not been assessed (for example, the app does not use JWT
`iss` claims). Plan the upgrades, then set `TRIVY_EXIT_CODE: "1"` so new HIGH/CRITICAL findings
fail the build. Until then, read the Trivy output in each image job.

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
negative control), YAML parsing, SHA-pin checks, and that every `with:` input exists in each pinned
action.

**Not verified:**

- The workflow has not run on GitHub yet, so expect to fix small things on the first run.
- `actionlint` was not run.
- Trivy was not run. (All three images were built and started with `docker compose up --build` on a
  developer machine, and the stack was exercised end to end, but not from a clean CI runner.)
- Some API tests are timing-based (heartbeat and token-expiry tests use short real timers); a heavily
  loaded runner could make one flaky.
- `dist/` currently also contains compiled `*.test.js` files, so images ship them. Excluding tests
  from the build `tsconfig` would slim the images but would stop `tsc` type-checking the tests.
- CodeQL is not configured.
