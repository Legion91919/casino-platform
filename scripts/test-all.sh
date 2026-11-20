#!/usr/bin/env bash
# Runs every test suite in this repo, the same way CI does.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> DB_VERIFY_EXTERNAL=1 PGHOST=db PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash tools/db-verify.sh"
DB_VERIFY_EXTERNAL=1 PGHOST=db PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash tools/db-verify.sh
echo "==> npm test (TypeScript: slot math, game server, Catwalk, SDK, dev floor) on the dev container's Postgres"
PGHOST=db PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres npm test
echo "==> python3 tools/validate-contracts.py"
python3 tools/validate-contracts.py
echo 'All tests passed.'
