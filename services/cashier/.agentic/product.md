# Product brief: Cashier

Owner: `team-cashier` · Tier 0 · Part of the Casino Platform suite (root `.agentic/product.md`). All names are invented.

## Problem
Game servers can't move a player's money safely across many operators, because retries, late callbacks and rollbacks can pay twice or lose a stake, and each operator reconciles to the cent.

## Users
Studio game servers (machine, ~2,000 bets/s peak), operators (transfers, daily reconciliation), Comps (bonus credits), compliance (money trail).

## Outcomes
p99 < 150 ms including the Pitboss check; zero unexplained reconciliation differences; zero double credits (property test + DB constraints).

## Constraints
Suite constraints apply (regulated markets, money rules ADR-0005, database per service ADR-0002, events via outbox ADR-0003).
Service specifics: Seamless wallet and bet ledger. Studio game servers debit stakes, credit wins and roll back; operators transfer money into hosted wallets; Comps moves bonus money. Every call is idempotent on the caller's transaction id and lands in a double-entry, append-only ledger.

## Traits (launch), with evidence
- `MoneyMovement`: "every bet is a debit and a credit; ~170 M wallet transactions per peak day"
- `RegulatoryAudit`: "regulators and operators trace every cent to a posting for 5-7 years"
- `ExternalPartnerIntegrations`: "studio game servers call us; pass-through operators expose their own wallets"
- `MultiTenant`: "four operators share the deployment; money may never cross between them"
- `SmallTeam`: "team-cashier is 6 engineers"

## Traits (global scale)
Same as launch, with `SmallTeam` replaced by:
- `GlobalScale` (global-scale only): "at the regional-cell stage, peak traffic from several regions"

## Advisor answer
- Launch: **CleanArchitecture**. One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
- Global scale: **Microservices**. Parts of the system face load that is orders of magnitude different from the rest, and they must scale and deploy on their own.
