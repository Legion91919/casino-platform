# Backlog: Comps

## Now
- [ ] **Slice 1**: A deposit-match bonus is awarded once per deposit, credited to the separate bonus balance, tracks wagering from BetSettled and completes or expires.
  - Given campaign WELCOME100 (100% up to 50.00, 30x), when Kestrel awards it for deposit dep-1 of 20.00, then a 20.00 award with 600.00 wagering is created, Cashier's bonus credit is called with the awardId, and BonusAwarded is emitted.
  - Given the same deposit is reported again, then the existing award is returned and nothing is credited twice.
  - Given an active award, when BetSettled events arrive for a 100.00 slot stake and a 100.00 table stake, then progress is 110.00 (slots 100%, table 10%), and a redelivered event changes nothing.
  - Given progress reaches 600.00, then the award completes, Cashier converts the remaining bonus balance to cash, and BonusCompleted is emitted.
  - Given the award passes its expiry first, then the sweep expires it, Cashier forfeits the bonus balance and BonusExpired is emitted.
  - Given PlayerExcluded for the player, then active awards are forfeited and new awards are refused.
  - Test notes: Unit: award calculator, contribution weighting, state machine. DB tests: idempotent award key, one active award per campaign, contribution de-duplication, expiry window, progress never decreases. Contract: consumes the BetSettled example; publishes Bonus* validated against schemas. Integration: Cashier bonus-credit stub with retries.
  - API: `POST /v1/campaigns`, `POST /v1/awards`, `GET /v1/players/{id}/awards`, `GET /v1/events` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
