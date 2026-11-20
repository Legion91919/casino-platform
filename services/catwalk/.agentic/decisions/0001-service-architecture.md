# ADR-0001 (Catwalk): Clean Architecture service on Node/TypeScript, read model on PostgreSQL with row-level security

- Status: accepted
- Date: 2026-11-20
- Owner: `team-catwalk`

## Context
Players review their own rounds. Catwalk reads two event feeds (studio round outcomes, Cashier
settlements), keeps a per-player history and serves a player-facing page. It never moves money.

Traits: `ReadHeavy RegulatoryAudit ExternalPartnerIntegrations MultiTenant PersonalData SmallTeam`.

## Advisor output
`arch-advisor recommend ReadHeavy RegulatoryAudit ExternalPartnerIntegrations MultiTenant PersonalData SmallTeam`
recommends **CleanArchitecture** with AuditTrail, CachedReadModel, AdapterPerPartner,
PersonalDataProtection and TenantIsolation, and warns: *one missing tenant filter leaks a client's
data; enforce it centrally, never per query*.

`arch-advisor compare` (same traits):

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Clean Architecture monolith | Recommended | 2 | Matches the advisor's recommended style (CleanArchitecture). |
| Layered monolith | Possible | 1 | Small team: low enough operational load to run comfortably. |
| Vertical slice monolith | Possible | 2 | Small team: low enough operational load to run comfortably. |
| Modular monolith | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Modular monolith + CQRS read models | Possible | 3 | Read-heavy: separate read models keep queries fast. |
| Serverless functions + queues | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Event-sourced core with CQRS | Possible | 4 | Audit: the event log is the audit trail, with replay for free. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

## Decision
1. **Clean Architecture inside one deployable**: `src/domain` (event validation), `src/app`
   (ingest decision, history queries, ports), `src/adapters` (Postgres, Dealer). The ingest rule
   "nothing unsigned reaches a player" is tested without a database.
2. **The tenant filter lives in PostgreSQL, not in queries** (the advisor's risk): reads run as
   `catwalk_reader` with `catwalk.operator_code` and `catwalk.player_id` set from the verified
   token for the transaction; RLS policies filter every row, the view is `security_invoker`, and an
   unset player sees nothing. A forgotten WHERE clause cannot leak a round.
3. **Two independent sources, compared, never merged**: `round_record` (studio, signed) and
   `wallet_settlement` (Cashier) are append-only; `round_view` derives confirmed / mismatch /
   pending, so arrival order does not matter and a mismatch can never be overwritten.
4. **Node/TypeScript** for this service (the suite's money services are .NET): Catwalk serves a
   player-facing page and shares the studio SDK (canonical JSON, Ed25519, tokens) with the studios'
   HTML5 game servers; it holds no money logic. Recorded so a reviewer does not read it as drift.

## Why not the others
- **Event-sourced core**: the history *is* already a log of facts from other services; Catwalk adds
  no decisions of its own to source.
- **Microservices**: one small team, one read model; nothing to scale independently yet.
- **CQRS inside the producers** (each studio serves history): every studio would build its own
  screen and nobody could compare it with the wallet. That comparison is the product.

## Evolve when
- Support-agent search arrives: a second read path with its own audited RLS policy (still one service).
- History reads exceed one primary: read replica; partitions are already monthly.
