# Backlog (suite)

Vertical slices, smallest valuable first. Each service's own backlog (`services/<name>/.agentic/backlog.md`)
holds the acceptance criteria; this file sequences them across teams.

## Now: walking skeleton of one bet round (all six teams, first 3 weeks)
The thinnest end-to-end path that settles the biggest risk ("can we take a stake exactly once, only
from an allowed player, and report it?"):

- [ ] **Cashier slice 1**: a game server debits a stake and credits a win in a hosted wallet, idempotently, after Pitboss approves; the ledger balances. (`services/cashier/.agentic/backlog.md`)
- [ ] **Pitboss slice 1**: an operator registers a player, sets a loss limit and can self-exclude them; Cashier's authorisation call approves or denies with a reason. (`services/pitboss/...`)
- [ ] **Dealer slice 1**: a studio publishes a build, compliance certifies it for Jurisdiction A, release rolls it to Kestrel Gaming at 10%, Kestrel launches it and the game server redeems the token; the kill switch stops it. (`services/dealer/...`)
- [ ] **Countroom slice 1**: BetSettled events from Cashier become bet facts and a daily GGR row; Kestrel downloads the day's GGR. (`services/countroom/...`)
- [ ] **Comps slice 1**: a deposit-match bonus is awarded once per deposit, credited to the separate bonus balance, tracks wagering from BetSettled and completes or expires. (`services/comps/...`)
- [ ] **Backstage slice 1**: a team scaffolds a service from the golden path and sees its scorecard filled by CI. (`services/backstage/...`)
- [ ] **Suite demo**: the DESIGN §6 sequence runs end to end against docker-compose with a fake game server; an e2e test asserts ledger zero-sum, one BetSettled, one GGR row, wagering progress.

## Next
- [ ] Pass-through wallet mode (operator holds the balance; Cashier adapter per operator, ledger mirrors it; reconciliation compares).
- [ ] Settlement reversal by an operator adjustment (four-eyes approval) and its SettlementReversed handling in Comps and Countroom.
- [ ] Reality-check events to the game client and session-time limit enforcement.
- [ ] Regulator export formats for Jurisdictions B and C; retention job with archive checksums.
- [ ] Free-spin campaigns (Dealer eligible games, Cashier zero-stake rounds funded by bonus cost).
- [ ] Contract-test harness in CI: producers validate outgoing events; consumers replay `contracts/events/examples`.

## Later
- [ ] Stake allowance lease (Pitboss pre-authorises a per-session budget) to take Pitboss off the per-bet path (DESIGN §9 step 3).
- [ ] Broker behind the outbox (ADR-0003 trigger).
- [ ] Regional cells for data residency.
- [ ] Cross-operator self-exclusion register integration (per jurisdiction).
