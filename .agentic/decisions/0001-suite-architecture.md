# ADR-0001: Suite architecture: microservices per business area, events via outbox

- Status: accepted
- Date: 2026-11-20
- Deciders: platform architecture group (all six team leads)

## Context
Six business areas (wallet, responsible gambling, game release, bonuses, reporting, developer portal)
with their own language, owners and change rates. Load is extremely uneven: the wallet takes ~2,000
bets/s at peak (two writes each), while the developer portal serves tens of requests a minute. Money
and responsible-gambling rules are regulated; release and reporting are not on the money path.
Six teams of 4–7 engineers must deploy independently.

Traits: SeveralBusinessAreas, MoneyMovement, RegulatoryAudit, PersonalData, MultiTenant,
ExternalPartnerIntegrations, ComplexBusinessRules, GlobalScale.

## Advisor output
`arch-advisor recommend <traits>` → **Microservices**: "Parts of the system face load that is orders
of magnitude different from the rest, and they must scale and deploy on their own." Patterns:
AppendOnlyLedger, IdempotencyKeys, TransactionalOutbox, AuditTrail, AdapterPerPartner,
PersonalDataProtection, TenantIsolation, EventStream. Closest references: banking/payments (0.63),
clinic (0.50), online gambling (0.44).

`arch-advisor compare <traits>`:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Microservices (request/response) | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Event-driven microservices | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Modular monolith + CQRS read models | Possible | 3 | Money: pair it with an append-only ledger and idempotency keys. |
| Event-sourced core with CQRS | Possible | 4 | Money: pair it with an append-only ledger and idempotency keys. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Layered monolith | Poor fit | 1 | Several business areas would tangle without module boundaries. |
| Vertical slice monolith | Poor fit | 2 | Several business areas would tangle without module boundaries. |
| Clean Architecture monolith | Poor fit | 2 | Several business areas would tangle without module boundaries. |
| Serverless functions + queues | Poor fit | 3 | Consistency-critical money or stock operations are awkward across stateless functions. |

For contrast, the same traits with `SmallTeam` instead of `GlobalScale` (what a 5-person start-up would get; top rows):

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Modular monolith | Recommended | 3 | Matches the advisor's recommended style (ModularMonolith). |
| Modular monolith + CQRS read models | Good alternative | 3 | Same family as the recommendation (ModularMonolith); a valid variant if its trade-offs suit the team. |
| Event-sourced core with CQRS | Good alternative | 4 | Same family as the recommendation (ModularMonolith); a valid variant if its trade-offs suit the team. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |

## Decision
1. **One service per business area** (cashier, pitboss, dealer, comps, countroom, backstage), each
   owned end to end by one team, each with its own PostgreSQL database (ADR-0002).
2. **A hybrid of the two microservice variants**: request/response only where the caller needs an
   answer before money moves (stake authorisation, launch, wallet calls, bonus credits);
   **event-driven** for every fact others react to (settlement, voids, exclusions, releases, bonus state),
   delivered through a transactional outbox (ADR-0003).
3. **Inside each service, Clean Architecture** (the advisor's per-service recommendation at launch),
   so rules are tested without the database, and the hot path can later be split further.

## Why not the alternatives
- **Modular monolith (simpler, "Possible")**: the strongest rival, and the right answer for a single
  team. It loses here because the wallet must scale and deploy on its own (100x the load of the portal,
  and a tier-0 change process the portal must not inherit), and six teams in one deployable would queue
  behind each other's releases. We keep its discipline: boundaries are contracts, not shared tables, so
  merging two services back is cheap (see "Revisit when").
- **Modular monolith + CQRS read models**: solves read load (Countroom), not the wallet's write load or team autonomy.
- **Event-sourced core with CQRS (more complex)**: the ledger already gives replayable money history; event-sourcing Pitboss and Dealer too would add projection and versioning cost with no regulatory gain over an append-only table plus a hash-chained audit log.
- **Pure event-driven microservices**: a stake cannot be accepted on an eventually-consistent view of limits or exclusions; those checks must be synchronous and fail closed.
- **Serverless functions + queues**: consistency-critical money with per-player serialisation and sub-150 ms p99 is awkward across stateless functions; cold starts on the bet path are unacceptable.
- **Layered / vertical slice / Clean monolith**: several business areas would tangle, and the hot part could not scale alone.

## Consequences
- Positive: independent deploys and scaling; the money path has the smallest possible blast radius; teams own their data.
- Negative: distributed failures, versioned contracts, eventual consistency between services (reports lag bets by seconds). Mitigated by: tracing from day one, idempotency everywhere, contract tests (`tools/validate-contracts.py`), per-consumer lag SLOs.
- Risks from the advisor and their mitigation:
  - *Distributed failures* → timeouts and fail-closed rules per integration (architecture.md table), OpenTelemetry tracing, incident drills (DESIGN §12).
  - *Floating-point money or update-in-place balances* → ADR-0005; ledger is append-only with a deferred zero-sum check, proven by DB tests.
  - *One missing tenant filter leaks a client's data* → tenant in composite FKs (Cashier), RLS (Pitboss), tests prove isolation.

## Revisit when
- Teams spend more time on infrastructure than features (advisor's trigger): merge services that always change together (Comps into Cashier is the first candidate).
- The suite stays under ~200 bets/s for a year: a modular monolith with a separate wallet would be cheaper.
- Outbox polling lag or database load from feed reads breaches its SLO (ADR-0003 trigger for a broker).
