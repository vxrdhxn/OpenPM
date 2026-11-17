#!/usr/bin/env sh
# Back up the OpenPM database to a file (pg_dump custom format: compressed, restorable per table).
#
#   scripts/backup-db.sh [FILE]                 # Docker Compose (default)
#   PG_EXEC="kubectl exec -i -n openpm deploy/openpm-postgres --" scripts/backup-db.sh   # in-chart Postgres
#
# For a managed database, run pg_dump against it directly (docs/backup-restore.md). The dump is
# consistent (one snapshot) and safe to take while OpenPM is running.
set -eu

FILE=${1:-openpm-$(date -u +%Y%m%dT%H%M%SZ).dump}
PG_EXEC=${PG_EXEC:-docker compose exec -T postgres}

# Write to a temporary name first, so an interrupted dump never looks like a finished backup.
# shellcheck disable=SC2016 # expanded by the shell inside the container
$PG_EXEC sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$FILE.partial"
mv "$FILE.partial" "$FILE"

# A dump that pg_restore cannot list is not a backup.
$PG_EXEC pg_restore --list < "$FILE" > /dev/null
echo "Backed up to $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"
