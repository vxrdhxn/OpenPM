#!/usr/bin/env sh
# Restore an OpenPM database dump made by backup-db.sh.
#
#   scripts/restore-db.sh FILE DATABASE          # into a new, empty database (safe: try it first)
#   scripts/restore-db.sh FILE DATABASE --replace   # drop DATABASE and restore over it
#
# Uses Docker Compose by default; set PG_EXEC as in backup-db.sh for Kubernetes. Stop the API and
# worker before replacing the live database (docs/backup-restore.md), or they write into it mid-restore.
set -eu

if [ $# -lt 2 ]; then
  echo "usage: $0 FILE DATABASE [--replace]" >&2
  exit 2
fi
FILE=$1
DB=$2
REPLACE=${3:-}
PG_EXEC=${PG_EXEC:-docker compose exec -T postgres}

case $DB in
  *[!a-zA-Z0-9_]*) echo "database name may contain only letters, digits and _" >&2; exit 2 ;;
esac
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 2; }

psql() { $PG_EXEC sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -qtAc \"$1\""; }

exists=$(psql "SELECT 1 FROM pg_database WHERE datname = '$DB'")
if [ "$exists" = "1" ]; then
  if [ "$REPLACE" != "--replace" ]; then
    echo "database $DB exists; pass --replace to drop it and restore over it" >&2
    exit 1
  fi
  psql "DROP DATABASE $DB WITH (FORCE)"
fi
psql "CREATE DATABASE $DB"

# --exit-on-error: a partial restore must fail loudly, not leave a half-filled database behind.
# --no-privileges: grants name the app's database user, which may not exist on this server yet. The
# next `migrate up` (it runs before the API starts) creates it and grants it again.
$PG_EXEC sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $DB --no-owner --no-privileges --exit-on-error" < "$FILE"
echo "Restored $FILE into $DB"
