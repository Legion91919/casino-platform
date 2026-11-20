# ADR-0003: Events via a transactional outbox in PostgreSQL, with polling consumers (no broker yet)

- Status: accepted
- Date: 2026-11-20

## Context
Services must react to each other's facts (a settled bet counts towards wagering, a self-exclusion
forfeits bonuses) without distributed transactions, and without ever losing an event or announcing
something that was rolled back. Peak volume: ~4,000 events/s from Cashier (BetPlaced + BetSettled per
round), well under 100/s from every other producer.

## Decision
1. **Outbox**: a producer writes its event rows into its own `outbox` table **in the same transaction**
   as the state change. Commit = state and event both exist; rollback = neither.
2. **Feed**: each producer serves `GET /v1/events?after=<cursor>&limit=500` from its outbox.
3. **Polling consumers**: each consumer polls each feed it needs every 250–1000 ms, processes events
   in order per `partitionKey`, records `eventId` in its `inbox` table in the same transaction as its
   own state change (exactly-once *effect* on at-least-once delivery), and stores its cursor in
   `consumer_checkpoint`.
4. **No skipped events**: identity values are assigned at insert but become visible at commit, so a
   later-committing transaction can hold a lower position. The cursor is therefore `(tx_id, position)`
   with `tx_id xid8 DEFAULT pg_current_xact_id()`, and the feed only returns rows with
   `tx_id < pg_snapshot_xmin(pg_current_snapshot())`, ordered by `(tx_id, position)`. Every
   transaction that could still commit has a `tx_id` at or above that horizon, so nothing can appear
   behind the cursor. (Tested: in-flight rows are invisible to the feed query.)
5. **Retention**: 14 days of outbox (Cashier: daily partitions, dropped; others: delete job). A consumer
   that falls further behind rebuilds from the producer's reconciliation API.
6. **Ordering and partitioning**: events carry `partitionKey` (round id, player id, game code); consumers
   may process different keys in parallel, never the same key out of order.

## Why not a broker yet
- **Fewer moving parts**: no new cluster to run, secure, upgrade and page on; the outbox is needed even
  *with* a broker (to publish atomically), so the broker would be an additional hop, not a replacement.
- **Load fits**: 4,000 events/s read by 3 consumers is ~12,000 row reads/s of an index range scan on a
  hot, recent partition: cheap for PostgreSQL, and served from a read replica if needed.
- **Replay for free**: consumers re-read from any cursor inside the window; no topic retention to tune.
- **Debuggable with SQL**: an incident responder can see exactly which events exist and which a consumer processed.

## Alternatives
- **Broker now (log-based stream or message queue)** (more complex): better fan-out, consumer groups,
  longer retention. Cost: a new tier-0 dependency on day one. Deferred, not rejected.
- **Change data capture from the WAL**: no outbox table needed, but couples consumers to table shapes
  (internal schema becomes a public contract). Rejected; the outbox keeps the contract explicit.
- **Synchronous calls for everything** (simpler): couples availability; Countroom slow = bets slow. Rejected.

## Consequences
- Every consumer must be idempotent (inbox) and tolerate seconds of lag.
- Producers carry a small feed API; Backstage's golden-path template provides it.
- Poll traffic grows with consumers × producers; that is the trigger below.

## Revisit when (switch to a broker, with the outbox relaying into it)
- More than ~6 consumers on one feed, or feed queries above 10% of the producer's database CPU;
- a consumer needs more than 14 days of replay;
- cross-region fan-out is needed (regional cells).
