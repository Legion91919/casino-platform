# Product brief: Countroom

Owner: `team-countroom` · Tier 2 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Operators and regulators can't get trustworthy daily revenue numbers on time, because they are assembled from many systems by hand, can't be re-run after a fix, and don't say how fresh they are.

## Users
Operators (daily GGR), compliance (regulator exports), finance (NGR), studios (game performance, later).

## Outcomes
Daily regulator report sealed by 06:00 local time; data freshness < 5 minutes; model totals reconcile to the clean layer and to Cashier's ledger daily.

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Bet and GGR/NGR reporting per operator, game and jurisdiction, built from events. Raw events are landed as received, cleaned into de-duplicated bet facts in daily partitions, and modelled into daily GGR by a re-runnable job. Regulator exports are sealed with a checksum; retention follows each jurisdiction.

## Traits (launch), with evidence
- `BatchDataFeeds`: "event feeds from Cashier, Pitboss, Comps and Dealer, plus daily operator files for reconciliation"
- `RegulatoryAudit`: "regulator reports must be reproducible and kept 5-7 years"
- `MultiTenant`: "operators see only their own numbers"
- `ReadHeavy`: "reports read far more than they write"
- `SmallTeam`: "team-countroom is 4 engineers"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `GlobalScale` (global-scale only): "~170 M bet facts per peak day at the regional stage"

## Advisor answer
- Launch: **CleanArchitecture**. One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
- Global scale: **Microservices**. Parts of the system face load that is orders of magnitude different from the rest, and they must scale and deploy on their own.
