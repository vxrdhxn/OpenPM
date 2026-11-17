#!/usr/bin/env sh
# Backup/restore drill: back up the running database, restore the dump into a scratch database, and
# check the copy is complete and usable:
#   - every table has the same number of rows as the original;
#   - the same migrations are recorded;
#   - running the migrator against the copy finds nothing to do (the schema is current).
# The original database is only read. Run it while OpenPM is idle, or row counts may differ because
# of writes after the dump.
#
#   scripts/test-backup-restore.sh                                     # Docker Compose
#   PG_EXEC="kubectl exec -i -n openpm deploy/openpm-postgres --" \
#   MIGRATE_EXEC="kubectl exec -n openpm deploy/openpm-api --" \
#   scripts/test-backup-restore.sh                                     # in-chart Postgres
set -eu
cd "$(dirname "$0")/.."

PG_EXEC=${PG_EXEC:-docker compose exec -T postgres}
# Somewhere the API image runs with DATABASE_URL set; the migrator is pointed at the scratch copy.
MIGRATE_EXEC=${MIGRATE_EXEC:-docker compose run --rm --no-deps -T migrate}
SCRATCH=openpm_restore_check
DUMP=$(mktemp "${TMPDIR:-/tmp}/openpm-drill.XXXXXX")
trap 'rm -f "$DUMP" "$DUMP.live" "$DUMP.copy"' EXIT

q() { $PG_EXEC sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $1 -qtAc \"$2\""; }

COUNTS="SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

# shellcheck disable=SC2016 # expanded by the shell inside the container
live_db=$($PG_EXEC sh -c 'echo "$POSTGRES_DB"' | tr -d '\r')

echo "1/4 backup"
scripts/backup-db.sh "$DUMP"

echo "2/4 restore into $SCRATCH"
q postgres "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" 2>/dev/null
scripts/restore-db.sh "$DUMP" "$SCRATCH"

echo "3/4 compare"
q "$live_db" "$COUNTS" > "$DUMP.live"
q "$SCRATCH" "$COUNTS" > "$DUMP.copy"
tables=$(wc -l < "$DUMP.live" | tr -d ' ')
rows=$(awk -F= '{ s += $2 } END { print s }' "$DUMP.live")
if ! diff "$DUMP.live" "$DUMP.copy"; then
  echo "FAIL: row counts differ (left: live, right: restored)" >&2; exit 1
fi
q "$live_db" "SELECT version FROM schema_migrations ORDER BY version" > "$DUMP.live"
q "$SCRATCH" "SELECT version FROM schema_migrations ORDER BY version" > "$DUMP.copy"
diff "$DUMP.live" "$DUMP.copy" || { echo "FAIL: migrations differ" >&2; exit 1; }
migrations=$(wc -l < "$DUMP.live" | tr -d ' ')

echo "4/4 migrator against the copy"
# shellcheck disable=SC2016 # expanded by the inner shell, where DATABASE_URL is set
out=$($MIGRATE_EXEC sh -c 'DATABASE_URL="${DATABASE_URL%/*}/'"$SCRATCH"'" node apps/api/dist/db/migrate.js up' 2>&1) \
  || { echo "$out" >&2; echo "FAIL: migrator failed on the copy" >&2; exit 1; }
echo "$out" | tail -2
echo "$out" | grep -q "up to date" || { echo "FAIL: the copy needed migrations" >&2; exit 1; }

q postgres "DROP DATABASE $SCRATCH WITH (FORCE)"
echo "OK: $tables tables, $rows rows and $migrations migrations restored identically"
