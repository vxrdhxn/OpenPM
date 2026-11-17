# Database access: a least-privilege app user

OpenPM connects to Postgres with two users:

| User | Used by | Can |
| --- | --- | --- |
| **Owner** (`DATABASE_MIGRATION_URL`) | the migration step only | everything: create, alter and drop tables |
| **App user** (`DATABASE_URL`) | the API and the worker | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on rows |

The app user cannot change the schema (`DROP`, `ALTER`, `CREATE`, `TRUNCATE`, functions), cannot
rewrite the migration history (`schema_migrations` is read-only for it), and cannot edit the
security audit log ([audit-log.md](audit-log.md)): it can add entries and delete expired ones, but
not `UPDATE` them. An SQL injection bug or a compromised API pod is therefore limited to what the
app's own queries could already do to rows.

`migrate up` sets this up every time it runs (`apps/api/src/db/appRole.ts`):

1. If the app user does not exist, it is created with the password from `DATABASE_URL`. This needs
   `CREATEROLE`; the Compose and in-chart Postgres owner has it.
2. It is granted the rights above on every table and sequence, including tables that new migrations
   just added.
3. `CREATE` on schema `public` is revoked from `PUBLIC` (the default since Postgres 15).

It refuses an app user that is the owner, a superuser, or can create roles or databases.

## Docker Compose

On by default. Compose needs `DATABASE_APP_PASSWORD` in `.env`, as it does `JWT_SECRET`:

```bash
echo DATABASE_APP_PASSWORD=$(openssl rand -hex 24) >> .env
docker compose up -d
```

The `migrate` service connects as `POSTGRES_USER` and creates `openpm_app`; the API and worker
connect as `openpm_app`. An existing Compose database is upgraded the first time `migrate` runs.

## Kubernetes (Helm)

**Values at install time, in-chart Postgres:** set `secrets.postgres.appPassword` (and optionally
`secrets.postgres.appUsername`, default `openpm_app`). The chart then puts the app user in
`DATABASE_URL` and the owner in `DATABASE_MIGRATION_URL`, which only the migration init container
receives. Without `appPassword`, everything connects as the owner, as before.

**`existingSecret` (production):** put the app user in `DATABASE_URL` and add a
`DATABASE_MIGRATION_URL` key with the owner. The migration init container reads it if present.

**Managed databases** where the owner cannot create roles: create the app user yourself once, then
let `migrate up` grant it:

```sql
CREATE ROLE openpm_app LOGIN PASSWORD '…';   -- no SUPERUSER, CREATEROLE or CREATEDB
```

## Rotating the app user's password

`migrate up` creates the user but never changes the password of an existing one. To rotate:

```sql
ALTER ROLE openpm_app PASSWORD '…new…';
```

then update `DATABASE_URL` (`.env` and `DATABASE_APP_PASSWORD` for Compose, the Secret for
Kubernetes) and restart the API and worker.

## Backups

Dumps are restored with `--no-privileges` ([backup-restore.md](backup-restore.md)), so restoring
onto a server where the app user does not exist yet works. The grants come back with the next
`migrate up`, which runs before the API starts.

Tests: the whole integration suite connects as an app user created this way
(`test/integration/globalSetup.ts`), so every route is tested with exactly these rights.
`databaseAccess.int.test.ts` checks what it must not be able to do.
