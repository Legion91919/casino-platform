# Runbook (suite)

## Verify the database design locally
```bash
tools/db-verify.sh                 # starts a throwaway PostgreSQL 16 on :55432, applies every migration, runs every DB test, stops it
python3 tools/validate-contracts.py   # event schemas, examples, OpenAPI files, contracts table
```
In CI: `DB_VERIFY_EXTERNAL=1 PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres tools/db-verify.sh` against a `postgres:16` service container.

## Run the databases
```bash
docker compose up -d pg-cashier pg-platform       # one dedicated server for Cashier, one shared for the other five databases
docker compose --profile verify run --rm db-verify
```

## Incident quick reference (full drills in docs/DESIGN.md §12)
| Symptom | First action |
|---|---|
| Stakes rejected with RG_UNAVAILABLE | Pitboss health and latency; do NOT switch Cashier to fail-open |
| Recon mismatch for an operator | Freeze adjustments for that operator; diff `wallet_txn` vs the operator's file by transaction id |
| Consumer lag alert | Check the consumer's last error in its inbox log; poison event → park it with reason, continue |
| Game paying wrongly | Dealer kill switch (game or build), then void open rounds via Cashier runbook |
| Partition missing alert | Run `ensure_monthly_partitions` / `ensure_daily_partitions`; the daily job should keep 3 months / 30 days ahead |
