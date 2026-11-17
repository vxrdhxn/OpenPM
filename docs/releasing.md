# Releasing, deploying and rolling back

Production runs exactly what `helm/openpm/values.prod.yaml` on `main` says: each image is pinned
by digest, and Argo CD's `openpm-prod` app deploys it when someone syncs it by hand. Every production
change is a reviewed commit, and every rollback is a revert.

```
npm run release:version -- X.Y.Z  →  PR, CI, merge  →  tag vX.Y.Z  →  release workflow
   → images on GHCR + GitHub Release + PR "deploy: vX.Y.Z to production"
   → merge that PR  →  argocd app sync openpm-prod  →  smoke test (PostSync)
```

## Versions

- Semantic versioning, `MAJOR.MINOR.PATCH`, tags `vX.Y.Z`. No pre-release tags yet.
- One version for the whole system: the root and workspace `package.json` files, `package-lock.json`,
  and the chart's `version` and `appVersion`. `tests/release/versions.test.ts` fails CI if they differ.
- Images: `ghcr.io/<owner>/openpm-{api,worker,frontend}:X.Y.Z`, plus `:sha-<commit>`. A released
  version is never overwritten (the workflow fails if the tag already exists), and production
  references the digest, so even a moved tag cannot change what runs.

## Cutting a release

Work through [release-checklist.md](release-checklist.md); the steps below are its middle part.

1. Write `docs/release-notes/vX.Y.Z.md` (what's new, upgrade steps, known limits; the workflow puts it
   at the top of the GitHub Release) and bump the version on a branch. Open a PR and merge it once CI
   passes:

   ```bash
   npm run release:version -- 1.2.0
   git commit -am "release: 1.2.0"
   ```

2. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v1.2.0 -m "v1.2.0" && git push origin v1.2.0
   ```

3. `.github/workflows/release.yml` then:
   - **verifies** that the tag matches the repository version, the commit is on `main`, and these CI
     checks passed on that exact commit: lint/build/test, integration, Helm, gitleaks and the three
     image builds;
   - **builds, scans (Trivy, blocking) and pushes** the three images with an SBOM and build
     provenance;
   - **creates the GitHub Release** with the release notes file, the image digests and generated notes;
   - **opens the PR "deploy: v1.2.0 to production"**, which pins `values.prod.yaml` to the new
     digests. It runs `helm lint` and checks the rendered chart first.

If a step fails after the images were pushed, fix the cause and release a new patch version. The
pushed version cannot be pushed again.

## Deploying to production

1. Review and merge the "deploy" PR.
2. Sync: `argocd app sync openpm-prod` (or **Sync** in the UI). `openpm-prod` never syncs on its own.
3. Argo CD applies the chart and waits for the rollout (the API's init container runs pending
   migrations first). Then the **smoke test** Job runs: API ready with its database, API live, an
   authenticated route answering 401 without credentials, and the frontend serving `/login`. If it
   fails, the sync is marked failed and the Job stays for `kubectl logs -n openpm-prod job/openpm-prod-smoke-test`.

The old pods keep serving until the new ones are ready (rolling update and PodDisruptionBudget), so a
release that never becomes ready causes no outage. It just leaves the sync in progress.

## Rolling back

**Revert the deploy PR's merge commit on `main`, then sync `openpm-prod`.**

```bash
git revert -m 1 <merge commit of "deploy: vX.Y.Z to production">
# push the revert (through a PR if main is protected), then:
argocd app sync openpm-prod
```

The revert pins the previous release's digests again, so git and the cluster stay in agreement.
The images are not rebuilt; the previous ones are still in the registry. Rehearsed on kind; see
[rehearsal.md](rehearsal.md#release-deploy-and-rollback-phase-8-2026-11-17).

### The database is not rolled back

Migrations only go forward when you roll back. The older version's init container skips migrations it
does not know ("Database is up to date") and starts on the newer schema. Rolling back is therefore
only safe if **every release's migrations are backward compatible with the previous release**:

- Add, don't change. New columns are nullable or have a default; new tables and indexes are fine.
- Rename or drop in two releases (expand/contract): release N stops using the column, and release
  N+1 drops it.
- A migration that the previous version cannot run against must not ship. Split it as above.

If a schema change has to be undone, roll the code back first, then run the down migration by hand
(`node apps/api/dist/db/migrate.js down 1` in an API pod). Down migrations are tested in CI, but this
loses whatever the dropped columns held.

## One-time setup

- **Package visibility:** GHCR packages pushed by the workflow start out private. Either make the
  three `openpm-*` packages public (package settings), or create a pull secret in `openpm-prod` and
  set `global.imagePullSecrets` in `values.prod.yaml`.
- **Allow the workflow to open PRs:** Settings → Actions → General → *Allow GitHub Actions to create
  and approve pull requests*.
- **CI on the deploy PR:** a PR opened with the default `GITHUB_TOKEN` does not trigger workflows, so
  required status checks never report on it. Add a `RELEASE_PR_TOKEN` repository secret (a
  fine-grained PAT or GitHub App token with *contents* and *pull requests* write) and the workflow
  uses it instead. Without it, the workflow's own `helm lint` and render check are the only checks
  on that PR.
- **Credentials:** create the `openpm-secrets` Secret in `openpm-prod` (and `openpm-dev`) before the
  first sync ([deploying.md](deploying.md#kubernetes-an-existing-secret-recommended)). Without it
  the pods do not start.
- **Argo CD:** apply `argocd/app-of-apps.yaml` once; `openpm-prod` tracks `main` with manual sync.
