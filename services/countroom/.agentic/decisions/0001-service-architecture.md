# ADR-0001 (Countroom): Clean Architecture inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-countroom`

## Context
Bet and GGR/NGR reporting per operator, game and jurisdiction, built from events. Raw events are landed as received, cleaned into de-duplicated bet facts in daily partitions, and modelled into daily GGR by a re-runnable job. Regulator exports are sealed with a checksum; retention follows each jurisdiction.

Launch traits: `BatchDataFeeds RegulatoryAudit MultiTenant ReadHeavy SmallTeam`. Global-scale traits: `BatchDataFeeds RegulatoryAudit MultiTenant ReadHeavy GlobalScale`.

## Advisor output
`arch-advisor recommend BatchDataFeeds RegulatoryAudit MultiTenant ReadHeavy SmallTeam` → **CleanArchitecture**: One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
Patterns: AuditTrail, CachedReadModel, TenantIsolation, SeparateIngestionPipeline.
Closest reference systems:
- Reporting warehouse fed by many sources (similarity 0.50): One re-runnable import job per source into a single warehouse, and a plain read-only reporting app on top.
- Document extraction with human review (similarity 0.29): Clean Architecture API plus a worker fed by a queue; fields the model is unsure about wait for a person.

`arch-advisor compare` at launch:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Clean Architecture monolith | Recommended | 2 | Matches the advisor's recommended style (CleanArchitecture). |
| Layered monolith | Possible | 1 | Batch feeds: scheduled, re-runnable import jobs fit well here. |
| Vertical slice monolith | Possible | 2 | Small team: low enough operational load to run comfortably. |
| Modular monolith | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Modular monolith + CQRS read models | Possible | 3 | Read-heavy: separate read models keep queries fast. |
| Serverless functions + queues | Possible | 3 | Batch feeds: scheduled, re-runnable import jobs fit well here. |
| Event-sourced core with CQRS | Possible | 4 | Audit: the event log is the audit trail, with replay for free. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

`arch-advisor compare` at global scale (top rows) → **Microservices**:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Microservices (request/response) | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Serverless functions + queues | Good alternative | 3 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Event-driven microservices | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Workable, but nothing in the profile calls for it. |

## Decision
Accept Clean Architecture plus the advisor's SeparateIngestionPipeline: one feed consumer per source landing raw events, one cleaning job, one modelling job (data-flows skill: raw -> clean -> model, re-runnable, lineage via job_run_id, reconciliation after each load). Stay on PostgreSQL with daily partitions; a columnar warehouse is the next step, not the first.

## Why not the alternatives
- **Querying the producers' databases (simpler)**: breaks ADR-0002 and puts reporting load on the wallet.
- **A columnar warehouse from day one (more complex)**: PostgreSQL with daily partitions and pre-aggregated ggr_daily answers every slice-1 question; add the warehouse when ad-hoc analytics over years of facts arrive.
- **Stream processing for GGR (more complex)**: regulators want daily, reproducible numbers; a re-runnable daily rebuild is simpler to prove than a streaming aggregate.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- A second business area appears with its own language: make it a module of a modular monolith.
- Search becomes the bottleneck: move it to a dedicated search service.
- At global scale: bet facts move to a columnar store fed from the same raw layer; ggr_daily stays in PostgreSQL for the API; ingestion consumers scale out by partition key.
