#!/usr/bin/env bash
# db-verify.sh: apply every service migration and run every DB test against real PostgreSQL 16.
#
# Local (default): starts a throwaway PostgreSQL 16 on port 55432 with a data dir under /tmp,
#   runs everything, then stops the server and deletes the data dir.
#   initdb refuses to run as root, so as root the server runs as $PG_OS_USER (default: postgres).
# CI / existing server: DB_VERIFY_EXTERNAL=1 PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=...
#   uses that server (for example a postgres:16 service container) and does not start or stop anything.
#
# One database per service (ADR-0002). Migrations run in version order (V001__, V002__ ...).
# A test passes by printing "PASS:" notices; any error stops that file and fails the run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PG_OS_USER="${PG_OS_USER:-postgres}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}" PGUSER="${PGUSER:-postgres}"
EXTERNAL="${DB_VERIFY_EXTERNAL:-0}"
DATA_DIR=""
LOG="$(mktemp /tmp/db-verify-log.XXXXXX)"

as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u "$PG_OS_USER" -- "$@"; else "$@"; fi; }

stop_server() {
  if [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ]; then
    as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
    echo "server stopped, data dir removed"
  fi
}
trap stop_server EXIT

if [ "$EXTERNAL" != "1" ]; then
  DATA_DIR="$(mktemp -d /tmp/casino-pg16.XXXXXX)"
  [ "$(id -u)" = "0" ] && chown "$PG_OS_USER" "$DATA_DIR"
  as_pg "$PGBIN/initdb" -D "$DATA_DIR" -U "$PGUSER" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" -w \
    -o "-p $PGPORT -k $DATA_DIR -c listen_addresses=127.0.0.1 -c fsync=off" start >/dev/null
  echo "started $("$PGBIN/postgres" --version) on port $PGPORT"
fi

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)
total_pass=0; failed=0

# Platform services, plus sample studio game servers (each studio owns its own database too).
for svc_dir in "$ROOT"/services/*/ "$ROOT"/studios/*/*/; do
  svc="$(basename "$svc_dir")"
  compgen -G "$svc_dir/db/migrations/V*.sql" >/dev/null || continue
  db="${svc//-/_}"
  PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE);" -c "CREATE DATABASE $db;"
  for m in $(ls "$svc_dir"db/migrations/V*.sql | sort -V); do
    if ! "${PSQL[@]}" -d "$db" -f "$m" >"$LOG" 2>&1; then
      echo "FAIL  $svc  migration $(basename "$m")"; cat "$LOG"; failed=1; continue 2
    fi
  done
  for t in $(ls "$svc_dir"db/tests/*.sql 2>/dev/null | sort); do
    if "${PSQL[@]}" -d "$db" -f "$t" >"$LOG" 2>&1; then
      n=$(grep -c 'PASS:' "$LOG" || true); total_pass=$((total_pass + n))
      printf 'ok    %-12s %-36s %3d assertions\n' "$svc" "$(basename "$t")" "$n"
    else
      printf 'FAIL  %-12s %s\n' "$svc" "$(basename "$t")"; grep -E 'FAIL|ERROR' "$LOG" | head -5; failed=1
    fi
  done
done

rm -f "$LOG"
echo "assertions passed: $total_pass"
if [ "$failed" != "0" ]; then echo "db-verify: FAILED"; exit 1; fi
echo "db-verify: all migrations applied and all DB tests passed"
