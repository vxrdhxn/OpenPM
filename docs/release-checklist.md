# Release checklist

Copy this into the release PR description and tick it off. The mechanics (version bump, tag, the
workflow, deploy and rollback) are in [releasing.md](releasing.md).

## Before the version bump

- [ ] CI is green on `main`, including the browser tests and image scans.
- [ ] No open high or critical alerts in the repository's **Security** tab (code scanning,
      Dependabot, secret scanning).
- [ ] `npm audit` reports 0 vulnerabilities.
- [ ] Every migration since the last release is additive (expand/contract), so the previous release
      still runs against the new schema and rollback works ([releasing.md](releasing.md#the-database-is-not-rolled-back)).
- [ ] The backup drill passes: `scripts/test-backup-restore.sh` ([backup-restore.md](backup-restore.md#drill)).
- [ ] `docs/release-notes/vX.Y.Z.md` is written: what's new, upgrade steps and known limits. The
      release workflow puts it at the top of the GitHub Release.
- [ ] Docs match the behavior: README, `docs/deploying.md` and the user guide, for any setting or
      screen that changed.

## The release

- [ ] `npm run release:version -- X.Y.Z`, PR, CI green, merge.
- [ ] Tag the merge commit `vX.Y.Z` and push the tag.
- [ ] The release workflow passes. The GitHub Release lists three images pinned by digest, and the
      "deploy: vX.Y.Z to production" PR is open.

## Deploy

- [ ] Take a database backup (managed: a provider snapshot, or `pg_dump`; see backup-restore.md).
- [ ] Merge the deploy PR, then `argocd app sync openpm-prod`.
- [ ] The PostSync smoke test passes, and `argocd app get openpm-prod` shows Synced and Healthy.
- [ ] Sign in and open a board on the production URL. Check Grafana: error rate and latency are
      normal, and no alerts are firing.

## If it goes wrong

- [ ] Revert the deploy PR and sync again ([releasing.md](releasing.md#rolling-back)). Restore the
      database only if data is damaged; a schema change alone does not need it.
