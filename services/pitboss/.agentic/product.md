# Product brief: Pitboss

Owner: `team-pitboss` · Tier 0 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Operators can't prove that no excluded or over-limit player ever staked, because limits, exclusions and rule versions live in different systems with partial history, and every jurisdiction has different rules.

## Users
Cashier (per-stake authorisation), Dealer (launch eligibility), operators (register players, set limits, exclusions), compliance (audit queries), players indirectly (limits they set).

## Outcomes
Authorisation p99 < 50 ms; zero stakes accepted from excluded players (daily audit query); every limit change and exclusion traceable with actor and rule-set version.

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Player accounts and responsible gambling: KYC status, deposit/loss/wager/session limits, cool-off and self-exclusion, per-jurisdiction rule sets, reality checks, and a tamper-evident audit log. Cashier asks Pitboss before accepting every stake.

## Traits (launch), with evidence
- `PersonalData`: "KYC status and date of birth are personal data"
- `RegulatoryAudit`: "every limit change and exclusion is asked for in audits, with who and which rule applied"
- `ComplexBusinessRules`: "three jurisdictions with different ages, cooling delays, minimum exclusion lengths and reality-check intervals"
- `MultiTenant`: "operators must never see each other's players"
- `SmallTeam`: "team-pitboss is 5 engineers including a compliance analyst"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `GlobalScale` (global-scale only): "on the bet path at 2,000 stakes/s"

## Advisor answer
- Launch: **CleanArchitecture**. One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
- Global scale: **Microservices**. Parts of the system face load that is orders of magnitude different from the rest, and they must scale and deploy on their own.
