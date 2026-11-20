# ADR-0001 (Dealer): Clean Architecture inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-dealer`

## Context
Game catalogue and launch for game teams: studios publish immutable, versioned builds (manifest + CDN assets), compliance records certification per jurisdiction, release managers roll builds out per operator by percentage, on-call can kill a game in seconds, operators launch games with a signed, short-lived token, and game health telemetry shows whether a build is healthy.

Launch traits: `MediaDelivery ExternalPartnerIntegrations MultiTenant ReadHeavy SmallTeam`. Global-scale traits: `MediaDelivery ExternalPartnerIntegrations MultiTenant ReadHeavy GlobalScale`.

## Advisor output
`arch-advisor recommend MediaDelivery ExternalPartnerIntegrations MultiTenant ReadHeavy SmallTeam` → **LayeredMonolith**: A single, simple business area. Layers are enough; anything more is ceremony.
Patterns: CachedReadModel, Cdn, AdapterPerPartner, TenantIsolation.
Closest reference systems:
- Reporting warehouse fed by many sources (similarity 0.50): One re-runnable import job per source into a single warehouse, and a plain read-only reporting app on top.
- Video or music streaming (similarity 0.29): Microservices with a CDN for the media itself and an event stream for playback events.

`arch-advisor compare` at launch:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Layered monolith | Recommended | 1 | Matches the advisor's recommended style (LayeredMonolith). |
| Vertical slice monolith | Good alternative | 2 | Same family as the recommendation (LayeredMonolith); a valid variant if its trade-offs suit the team. |
| Clean Architecture monolith | Possible | 2 | Media: serve files from a CDN whatever the style. |
| Modular monolith | Possible | 3 | Media: serve files from a CDN whatever the style. |
| Modular monolith + CQRS read models | Possible | 3 | Read-heavy: separate read models keep queries fast. |
| Serverless functions + queues | Possible | 3 | Media: serve files from a CDN whatever the style. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Event-sourced core with CQRS | Poor fit | 4 | Event sourcing's cost isn't repaid without audit, money or replay needs. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

`arch-advisor compare` at global scale (top rows) → **Microservices**:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Microservices (request/response) | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Serverless functions + queues | Good alternative | 3 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Event-driven microservices | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Media: serve files from a CDN whatever the style. |

## Decision
The advisor recommends a layered monolith (read-heavy, no money). Judgement overrides one step up to **Clean Architecture**: the certification gate, rollout arithmetic and kill-switch resolution are regulated rules (serving an uncertified build is a licence breach), so they are domain code with exhaustive tests, and the database re-checks them (deferred constraint trigger, `resolve_build`). Assets never pass through the service: the CDN serves content-addressed paths.

## Why not the alternatives
- **Layered monolith (advisor's pick, simpler)**: acceptable for the catalogue, but the certification gate must not depend on controller discipline.
- **Feature-flag product for rollouts (bought)**: rollouts must join certification and kill switches in one decision with an audit trail; a generic flag service would duplicate state across two systems.
- **Separate launch service now (global-scale answer)**: launch is a read of the same rollout state; extract it behind a cached read model when launch traffic needs regional deployment.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- Business rules start leaking into controllers or SQL: move to Clean Architecture.
- A second business area appears: split into modules.
- Search becomes the bottleneck: move it to a dedicated search service.
- At global scale: launch becomes a regional read-only service with a cached rollout snapshot (pushed on change, 5 s TTL), while publish/certify/rollout stays central.
