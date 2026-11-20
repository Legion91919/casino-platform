# ADR-0001 (Comps): Clean Architecture inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-comps`

## Context
Bonus engine: deposit-match and free-spin campaigns, awards that are idempotent per triggering fact, wagering requirements tracked from BetSettled events and weighted by game category, expiry, and a bonus balance kept separate from cash (the money sits in Cashier; Comps owns rules and state).

Launch traits: `ComplexBusinessRules MoneyMovement LongRunningWorkflows MultiTenant SmallTeam`. Global-scale traits: `ComplexBusinessRules MoneyMovement LongRunningWorkflows MultiTenant GlobalScale`.

## Advisor output
`arch-advisor recommend ComplexBusinessRules MoneyMovement LongRunningWorkflows MultiTenant SmallTeam` → **CleanArchitecture**: One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
Patterns: AppendOnlyLedger, IdempotencyKeys, TransactionalOutbox, Sagas, TenantIsolation.
Closest reference systems:
- Lending back office (loans, drawdowns, repayments) (similarity 0.43): Modular monolith (applications, servicing, cash, statements) with an append-only cash ledger and sagas for drawdowns.
- Employee tool (leave, timesheets) (similarity 0.33): Monolith: layered, or Clean Architecture if the approval rules are complex.

`arch-advisor compare` at launch:

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

`arch-advisor compare` at global scale (top rows) → **Microservices**:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Event-driven microservices | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Microservices (request/response) | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Modular monolith + CQRS read models | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |

## Decision
Accept Clean Architecture with an explicit award state machine (the advisor's Sagas pattern): awarded -> pending_credit -> active -> completed | expired | forfeited, each money step a keyed, idempotent call to Cashier. Comps never holds money; the ledger stays in one place (ADR-0005).

## Why not the alternatives
- **Bonus balance inside Comps (own ledger)**: two ledgers would need cross-service reconciliation for every bet; one ledger in Cashier with a separate player_bonus account is simpler and auditable.
- **Layered monolith (simpler)**: the wagering rules (weighting, expiry windows, completion) need isolated tests.
- **Event-sourced awards (more complex)**: award history is short and fully captured by the append-only contributions table.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- A second business area appears with its own language: make it a module of a modular monolith.
- At global scale: the BetSettled consumer shards by player id (partition key) across workers; only players with an active award (a small set) are evaluated, from an in-memory index rebuilt from the database.
