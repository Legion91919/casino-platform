# Lessons

- Unique constraints on partitioned tables must include the partition key: hash-partition on the idempotency key itself (Cashier `wallet_txn`), or partition on a value the event fixes (Countroom `business_date`), to keep de-duplication global.
- An outbox read by `position > last` can skip a slow commit. Order and filter by `(tx_id, position)` below `pg_snapshot_xmin(pg_current_snapshot())`.
- A hash chain ordered by an identity column breaks under concurrency (identity is assigned before the lock). Assign a chain sequence under the advisory lock.
- Running-balance rows for house accounts are contention hot spots; keep running balances only where per-row serialisation is the point (player accounts).
- `SET CONSTRAINTS ALL IMMEDIATE` inside a test subtransaction is how to test deferred constraint triggers without committing.
