# Product brief: Backstage

Owner: `team-backstage` · Tier 3 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Teams and studios can't start or run a service the platform way without tribal knowledge, and nobody can see at a glance whether a service meets the bar, including how AI-assisted changes are governed.

## Users
Platform engineers and studio developers (daily), team leads (weekly scorecards), new joiners (onboarding), CI (posts results).

## Outcomes
New service from template to first green deploy in under 1 day; every production service visible with a scorecard; 100% of AI-assisted changes with human review, 100% of tier-0 ones with critic review.

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Developer portal for platform teams and game studios: golden-path templates that come with the kit's Baton (`.agentic/`), CI, OpenAPI stub, migrations with DB tests, outbox and telemetry; a service catalogue; scorecards per team (tests, coverage, SLOs, security, AI governance: review coverage, critic reviews, prompt registry, eval gates); onboarding.

## Traits (launch), with evidence
- `InternalUsersOnly`: "used by platform staff and contracted studios only"
- `ReadHeavy`: "people read scorecards; CI writes a few hundred results a day"
- `SmallTeam`: "team-backstage is 4 engineers"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `SeveralBusinessAreas` (global-scale only): "later: catalogue, templates, scorecards and AI governance may grow into separate areas"

## Advisor answer
- Launch: **LayeredMonolith**. A single, simple business area. Layers are enough; anything more is ceremony.
- Global scale: **ModularMonolith**. Several business areas need clear boundaries, but one deployment and one database keep it cheap to run and easy to hand over.
