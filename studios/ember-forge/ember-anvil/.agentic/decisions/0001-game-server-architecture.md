# ADR-0001 (Ember Anvil): Clean Architecture game server; decide, freeze, then pay

- Status: accepted
- Date: 2026-11-20
- Owner: Ember Forge Studio (invented)

## Context
A slot game server takes stakes through the platform's seamless wallet, draws reel stops, pays wins
and records every round. Traits: `MoneyMovement ComplexBusinessRules ExternalPartnerIntegrations RegulatoryAudit SmallTeam`.

## Advisor output
`arch-advisor recommend` → **CleanArchitecture**, with AppendOnlyLedger, IdempotencyKeys,
TransactionalOutbox, AuditTrail and AdapterPerPartner.

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Clean Architecture monolith | Recommended | 2 | Matches the advisor's recommended style (CleanArchitecture). |
| Layered monolith | Possible | 1 | Small team: low enough operational load to run comfortably. |
| Vertical slice monolith | Possible | 2 | Small team: low enough operational load to run comfortably. |
| Modular monolith | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Modular monolith + CQRS read models | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Event-sourced core with CQRS | Possible | 4 | Money: pair it with an append-only ledger and idempotency keys. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Serverless functions + queues | Poor fit | 3 | Consistency-critical money or stock operations are awkward across stateless functions. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

## Decision
- **Domain**: `src/math` is pure (strips, lines, paytable, `evaluate`, exact RTP); the browser
  replay renderer imports the same files, so the replay can never disagree with the server's rules.
- **Use case**: `SpinService` orders the steps: open round (client roundId = idempotency key, wallet
  txn ids minted as UUIDv7 and stored) → debit → draw and **freeze** the outcome → credit → settle +
  signed event in one transaction. Each step is a conditional update on the expected state, and the
  database trigger refuses any change to a decided outcome.
- **Ports/adapters**: Cashier wallet and Dealer over HTTP; Postgres store; an in-memory store and fake
  wallet for fast tests of every failure path.
- **Background resumer**: settles rounds left `decided` by a wallet outage, and rolls back rounds left
  `opened` (stake unknown) using Cashier's tombstoning rollback. It never takes a new stake.

## Why not the others
- **Event-sourced core**: the round row plus the outbox already gives a full history; the state
  machine has five states and no long-lived aggregate worth sourcing.
- **Serverless functions**: debit, decide and credit must be ordered and retried as one story;
  stateless functions spread that across invocations and make the no-re-spin rule harder to prove.
