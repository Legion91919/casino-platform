# ADR-0002: Database per service, on PostgreSQL 16

- Status: accepted
- Date: 2026-11-20

## Context
Each service owns its data (ADR-0001). The money path needs strict transactions, constraints that
reject bad data at the source (zero-sum postings, unique idempotency keys, no overlapping limits), and
partitioning for very large append-only tables. Teams know PostgreSQL; regulators accept it.

## Decision
- **Every service has its own PostgreSQL 16 database and its own schema and roles.** No service
  connects to another service's database; no cross-database joins, no shared tables, no foreign data wrappers.
- **Physical layout at launch**: Cashier gets a **dedicated** primary + synchronous standby (tier 0, hot
  path). The other five databases share one server pair, each with separate owner and app roles
  (`docker-compose.yml` mirrors this: `pg-cashier` and `pg-platform`). A database moves to its own
  server when its load or change process differs (Pitboss is next, it sits on the bet path too).
- **The database enforces the invariants that must never break** (not only the application): money
  postings sum to zero (deferred constraint trigger), idempotency keys are unique, exclusions and
  ledger rows are append-only, limits and rule sets never overlap (exclusion constraints with
  btree_gist), builds must be certified before rollout, tenants are isolated (composite FKs, RLS).
  Each of these has a test in `services/<name>/db/tests/` that runs against real PostgreSQL 16
  (`tools/db-verify.sh`, also in CI with a `postgres:16` service container).
- **Migrations** are plain versioned SQL (`V001__init.sql`, `V002__...`), forward-only, applied by
  the service's deploy job before the new version takes traffic; every migration must be
  backward-compatible with the running version (expand, migrate, contract).
- **Partitioning**: range by month (Cashier `ledger_entry`) or day (Countroom `bet_fact`,
  `raw_event`, Cashier `outbox`, Dealer `launch_session`) for retention and pruning; hash (Cashier
  `wallet_txn`, `game_round`) where a natural key must stay globally unique and writes must spread.
- Only vanilla PostgreSQL plus contrib (`btree_gist`): no extension the managed offerings lack.
  Partition maintenance uses small SQL functions; pg_partman is the upgrade path.

## Alternatives
- **One shared database with a schema per service** (simpler): cheaper, but one service's
  migration or runaway query can stall the wallet, and the temptation to join across schemas
  erodes the boundaries. Rejected for tier 0; we get most of the cost benefit by sharing a *server*.
- **A distributed SQL database for Cashier** (more complex): horizontal writes and multi-region,
  but higher latency per transaction, a less familiar operating model, and 2,000 bets/s fits one
  well-sized PostgreSQL primary with headroom (DESIGN §3). Revisit at the regional-cell step.
- **Event store for the ledger**: see ADR-0001 (event sourcing rejected for now).
- **Document database**: weaker constraints exactly where we need the strongest.

## Consequences
- Reports needing data from several services are built from events (Countroom), never by joining databases.
- Each team runs its own migrations and DB tests; Backstage's golden path ships the test harness (`tools/sql/test_helpers.sql`).
- More databases to back up and monitor; mitigated by a shared server for low tiers and one backup/PITR policy.

## Revisit when
Cashier's primary passes 60% CPU or 70% of WAL throughput at peak (shard by operator, see DESIGN §9),
or a jurisdiction requires in-region data (regional cells).
