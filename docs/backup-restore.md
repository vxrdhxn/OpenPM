# Backup and restore

## What holds data

| Store | Holds | Back it up? |
| --- | --- | --- |
| **Postgres** | Everything: workspaces, users, projects, tasks, comments, labels, notifications, attachment records, activity, applied migrations. | **Yes.** This is the backup. |
| **Object storage** (S3, MinIO, R2) | Attachment file contents, keyed by the attachment records in Postgres. | Yes, with the bucket's own tools: turn on versioning, and replication if you need another region. |
| Redis | Cache, rate-limit counters, job queue (emails, attachment cleanup). | No. It refills itself. Jobs queued at the moment Redis is lost are lost (e.g. an invite email; send it again). |

A database restore brings back attachment *records* as of the dump. Files uploaded later have no
record and are never shown; files deleted later are gone from storage, and opening such an
attachment fails. Bucket versioning lets you recover those deleted files.

## Back up

Taking a dump is safe while OpenPM runs: `pg_dump` reads one consistent snapshot.

```bash
scripts/backup-db.sh                       # Compose: writes openpm-<UTC time>.dump
PG_EXEC="kubectl exec -i -n openpm deploy/openpm-postgres --" scripts/backup-db.sh   # in-chart Postgres
pg_dump "$DATABASE_URL" --format=custom --no-owner -f openpm.dump                    # managed database
```

The script writes to a temporary name first and checks that `pg_restore` can read the file, so an
interrupted dump is never mistaken for a backup. Store dumps away from the database server, and
encrypt them: they contain password hashes and everything users wrote.

For a **managed database** (what `values.prod.yaml` expects), use the provider's automated backups
with point-in-time recovery as the main protection, and take a `pg_dump` before each release as a
portable copy that does not depend on the provider.

For the **in-chart Postgres**, schedule the script (cron or a CI job). The chart has no backup job.

## Restore

Always restore into a new database first and look at it:

```bash
scripts/restore-db.sh openpm-20261117T101943Z.dump openpm_restored
```

To replace the live database:

1. Stop everything that writes to it: `docker compose stop api worker`, or
   `kubectl -n openpm scale deploy openpm-api openpm-worker --replicas=0` (in Argo CD, pause
   auto-sync first or it scales them back).
2. Restore over it: `scripts/restore-db.sh FILE openpm --replace`. This drops the database first;
   there is no undo, so take a fresh backup of it first if anything in it might be wanted.
3. Start the API and worker again. They apply any migrations the dump predates, so a dump from an
   older release restores into a newer one. Restores leave out grants (`--no-privileges`, since the
   app's database user may not exist on this server); the same migration step grants them again
   ([database-access.md](database-access.md)), so start through it, not around it. A dump from a *newer* release than the one running does
   not work: deploy that release first.
4. Everyone keeps their session (tokens are checked against the restored users). Users created after
   the dump no longer exist and are signed out.

Set `PG_EXEC` for Kubernetes as for backups. For a managed database, use the provider's restore, or
`pg_restore --no-owner --no-privileges --exit-on-error -d "$NEW_DATABASE_URL" FILE` into a new
database, switch `DATABASE_URL` (and `DATABASE_MIGRATION_URL`) to it, and run the migration step.

## Drill

`scripts/test-backup-restore.sh` checks that a backup can actually be restored. It backs up the running
database, restores it into a scratch database, and checks:

- every table has the same row count;
- the same migrations are recorded;
- the migrator finds nothing to do.

It only reads the live database. Run it before each release (it is on the
[release checklist](release-checklist.md)) and after changing anything about backups.

Last run, 2026-11-17, Compose: a 12 MB dump of 14 tables and 230,268 rows (load-test data), with 19
migrations, was restored identically and needed no migrations.
