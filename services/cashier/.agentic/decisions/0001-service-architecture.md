# ADR-0001 (Cashier): Clean Architecture inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-cashier`

## Context
Seamless wallet and bet ledger. Studio game servers debit stakes, credit wins and roll back; operators transfer money into hosted wallets; Comps moves bonus money. Every call is idempotent on the caller's transaction id and lands in a double-entry, append-only ledger.

Launch traits: `MoneyMovement RegulatoryAudit ExternalPartnerIntegrations MultiTenant SmallTeam`. Global-scale traits: `MoneyMovement RegulatoryAudit ExternalPartnerIntegrations MultiTenant GlobalScale`.

## Advisor output
`arch-advisor recommend MoneyMovement RegulatoryAudit ExternalPartnerIntegrations MultiTenant SmallTeam` → **CleanArchitecture**: One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
Patterns: AppendOnlyLedger, IdempotencyKeys, TransactionalOutbox, AuditTrail, AdapterPerPartner, TenantIsolation.
Closest reference systems:
- Internet provider (fibre/LTE) (similarity 0.29): Modular monolith, with sagas for weeks-long orders and adapters for the network operators.
- Food delivery (similarity 0.29): Modular monolith, but split live tracking and dispatch into their own service early.

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
| Microservices (request/response) | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Event-driven microservices | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Modular monolith + CQRS read models | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |

## Decision
Accept Clean Architecture inside the service: the domain (postings, round state machine, idempotency decisions) is tested without the database; adapters for the Pitboss client, the operator wallet (pass-through mode) and PostgreSQL sit outside. The database still enforces the invariants that must never break (ADR-0005), because a bug in any adapter must not be able to unbalance the books.

## Why not the alternatives
- **Layered monolith (simpler)**: money rules would leak into controllers and SQL; the idempotency and rollback rules need isolated tests.
- **Event-sourced core (more complex)**: the append-only ledger already is the money event log; event-sourcing rounds and balances adds projections on the hot path for no audit gain.
- **Splitting Cashier now into wallet + ledger + reconciliation services (global-scale answer)**: one team, one transaction boundary: a debit and its posting must commit together. Split reconciliation first when it needs its own release cadence.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- A second business area appears with its own language: make it a module of a modular monolith.
- At global scale the advisor says Microservices: the first extraction is reconciliation (batch, operator files, different cadence); the second is sharding the wallet by operator into cells, each a copy of this service with its own database.
