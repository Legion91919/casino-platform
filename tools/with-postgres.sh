#!/usr/bin/env bash
# with-postgres.sh <command...>: run a command with PGHOST/PGPORT/PGUSER pointing at PostgreSQL 16.
# Uses an existing server when PGHOST is already set (Codespaces: the `db` service; CI: a service
# container). Otherwise starts a throwaway server on port 55433 under /tmp and removes it afterwards.
set -euo pipefail
if [ -n "${PGHOST:-}" ]; then exec "$@"; fi
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PG_OS_USER="${PG_OS_USER:-postgres}"
# First free port from 55433 up, so a server left behind by an interrupted run can't block this one.
free_port() { python3 -c 'import socket,sys
for p in range(55433, 55533):
    s = socket.socket()
    try: s.bind(("127.0.0.1", p)); s.close(); print(p); sys.exit(0)
    except OSError: pass
sys.exit(1)'; }
export PGHOST=127.0.0.1 PGPORT="${PGPORT:-$(free_port)}" PGUSER=postgres
DATA_DIR="$(mktemp -d /tmp/casino-pg-tests.XXXXXX)"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u "$PG_OS_USER" -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null 2>&1 || true; rm -rf "$DATA_DIR"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown "$PG_OS_USER" "$DATA_DIR"
as_pg "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" -w -o "-p $PGPORT -k $DATA_DIR -c listen_addresses=127.0.0.1 -c fsync=off" start >/dev/null
"$@"
