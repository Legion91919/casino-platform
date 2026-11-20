# ADR-0005: Idempotency and money rules

- Status: accepted
- Date: 2026-11-20

## Context
Game servers retry on timeouts; callbacks arrive twice, late, or out of order (a rollback before its
stake). Operators reconcile to the cent. A single double-credit is a financial loss and a regulatory
finding; a single float rounding error makes the books unprovable.

## Decision: money
1. **Amounts are `bigint` minor units plus a currency code** (`EUR` 2 decimals, `JPY` 0). No floats,
   no `numeric` balances, no mixed-currency postings. JSON carries `{ "amountMinor": 250, "currency": "EUR" }`.
2. **Double-entry, append-only ledger**: every money movement is a posting of two or more entries
   that **sum to zero per currency**, enforced by a deferred constraint trigger at commit. Entries are
   never updated or deleted (trigger, and the app role is granted only SELECT and INSERT); a correction is a new reversing posting.
3. **Operator and currency travel in the foreign key** from entry to account, so an entry can never
   touch another operator's account or a different currency.
4. **Player balances never go negative** (check constraint on the running balance, updated in the same
   transaction as the entry). House accounts keep no running balance (hot rows); their balance is the
   sum of their entries.
5. **Bonus money is separate**: each player has a `player_cash` and a `player_bonus` account.
   Comps decides; Cashier moves the money.
6. **Daily reconciliation** with each operator per currency: our net movement vs theirs, stored in
   `recon_run`; a run cannot be "matched" with a non-zero difference.

## Decision: idempotency
1. **The caller's transaction id is the key**, unique per operator for as long as the transaction is in
   Cashier's hot store: `PRIMARY KEY (operator_code, game_server_txn_id)` on `wallet_txn`
   (hash-partitioned so the key stays globally unique). Pitboss's stake decisions use the same key.
   The studio integration contract requires **time-ordered ids (UUIDv7 or ULID)**: Cashier refuses an id
   whose embedded timestamp is older than 30 days (`KEY_EXPIRED`), and keeps keys hot for 90 days before
   archiving them. A key therefore can never be accepted again after its record left the hot store.
2. **Store the outcome, accepted or rejected**, with a SHA-256 of the canonical request and the response.
   Same key + same hash → replay the stored response (`Idempotent-Replay: true`). Same key + different
   hash → `409 IDEMPOTENCY_CONFLICT`. A retried stake can therefore never flip from rejected to accepted.
3. **Rollback before stake** → write a tombstone row for the unseen stake id
   (`ROLLED_BACK_BEFORE_SEEN`); the late stake collides with it and is refused.
4. **A transaction is reversed at most once** (`txn_reversal` primary key on the reversed id).
5. **Wins and rollbacks are never refused for limits or exclusion** (the player is owed the money);
   only stakes are gated.
6. **Commands between services carry their own keys**: Comps → Cashier uses `awardId + operation`;
   operator transfers use the operator's transfer id; Countroom de-duplicates on `eventId`.

## Alternatives
- **Time-boxed idempotency (24 h keys in a cache)**: simpler, but a callback replayed after the window
  would move money twice. Rejected for money; acceptable for non-money endpoints.
- **Decimal (`numeric`) amounts**: exact, but slower and invites fractional cents. Rejected.
- **Balance-only (no ledger)**: cannot prove how a balance came to be. Rejected.

## Consequences
- At ~170 M wallet transactions per peak day the key table is the largest hot table (~1–2 TB for 90 days):
  hash partitions keep each index manageable, a continuous batched job archives rows older than 90 days
  (with their keys) to the cold store that also holds detached ledger months, and DESIGN §9 describes
  the next step (operator shards).
- Game servers may retry or roll back for at most 72 hours; after that, corrections are operator
  adjustments with four-eyes approval, not game-server calls.
- Every studio integration must send stable transaction ids; the certification checklist tests retries.
