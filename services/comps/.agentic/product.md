# Product brief: Comps

Owner: `team-comps` · Tier 1 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Operators can't run bonuses without leaking money or breaking rules, because awards get duplicated on retries, wagering is counted twice on redelivered events, and bonus money gets mixed with cash.

## Users
Operator CRM teams (campaigns, awards), players (see progress through the operator UI), finance (bonus cost in NGR), compliance (no bonuses to excluded players).

## Outcomes
Zero duplicate awards; wagering progress within 60 s of settlement (p99); zero bonuses awarded or kept active for an excluded player.

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Bonus engine: deposit-match and free-spin campaigns, awards that are idempotent per triggering fact, wagering requirements tracked from BetSettled events and weighted by game category, expiry, and a bonus balance kept separate from cash (the money sits in Cashier; Comps owns rules and state).

## Traits (launch), with evidence
- `ComplexBusinessRules`: "match percentages, caps, wagering multipliers, game weighting, jurisdiction eligibility"
- `MoneyMovement`: "awards, conversions and forfeits move bonus money (via Cashier)"
- `LongRunningWorkflows`: "an award lives up to 90 days: awarded -> wagering -> completed or expired"
- `MultiTenant`: "campaigns belong to one operator"
- `SmallTeam`: "team-comps is 4 engineers"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `GlobalScale` (global-scale only): "BetSettled at up to 2,000/s to evaluate against active awards"

## Advisor answer
- Launch: **CleanArchitecture**. One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
- Global scale: **Microservices**. Parts of the system face load that is orders of magnitude different from the rest, and they must scale and deploy on their own.
