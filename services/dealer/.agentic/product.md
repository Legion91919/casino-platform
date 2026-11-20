# Product brief: Dealer

Owner: `team-dealer` · Tier 1 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Studios can't ship a build to many operators safely, because certification differs per jurisdiction, there is no gradual rollout or instant kill switch, and launch URLs are long-lived and shareable.

## Users
Studios (publish builds, weekly), compliance (certificates), release managers (rollouts), on-call (kill switch), operators (launch, ~200 launches/s peak), game servers (redeem token).

## Outcomes
Release to 10% canary in under 1 hour; kill switch effective in < 5 s; zero launches of a build in a jurisdiction where it is not certified.

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Game catalogue and launch for game teams: studios publish immutable, versioned builds (manifest + CDN assets), compliance records certification per jurisdiction, release managers roll builds out per operator by percentage, on-call can kill a game in seconds, operators launch games with a signed, short-lived token, and game health telemetry shows whether a build is healthy.

## Traits (launch), with evidence
- `MediaDelivery`: "game assets (10-80 MB per build) are served to players worldwide"
- `ExternalPartnerIntegrations`: "studios' CI, test labs' certificates, operators' lobbies"
- `MultiTenant`: "rollouts and kill switches are per operator"
- `ReadHeavy`: "launch and catalogue reads outnumber publishes ~10,000 to 1"
- `SmallTeam`: "team-dealer is 5 engineers"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `GlobalScale` (global-scale only): "launch traffic from several regions"

## Advisor answer
- Launch: **LayeredMonolith**. A single, simple business area. Layers are enough; anything more is ceremony.
- Global scale: **Microservices**. Parts of the system face load that is orders of magnitude different from the rest, and they must scale and deploy on their own.
