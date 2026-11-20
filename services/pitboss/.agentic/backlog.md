# Backlog: Pitboss

## Now
- [ ] **Slice 1**: An operator registers a player, sets a loss limit and can self-exclude them; Cashier's authorisation call approves or denies with a reason, and every change is audited.
  - Given an operator registers player K-1001 in JUR-A with KYC verified and age verified, when Cashier asks to authorise a 2.50 stake, then the decision is approved with the rule-set version that applied.
  - Given the player set a daily loss limit of 50.00 and has lost 49.00 today, when a 2.50 stake is authorised, then it is denied with LOSS_LIMIT and a LimitBreached event is written.
  - Given the player self-excludes indefinitely, when any stake is authorised, then it is denied with EXCLUDED, a PlayerExcluded event is written, and no API can shorten or remove the exclusion.
  - Given a denial for gs-100, when Cashier retries gs-100, then the original denial is returned (the decision never flips).
  - Given operator Kestrel's credentials, when it reads or writes a Baobab player, then it sees nothing and cannot write (row-level security).
  - Given any write above, then an audit row exists whose hash chain verifies.
  - Test notes: Unit: decision table per jurisdiction (age, KYC, exclusion, each limit type, max stake). Integration: RLS with a non-owner app role. DB tests: overlap, append-only, audit chain tamper detection. Load: 2,000 authorisations/s with p99 < 50 ms on the target instance size.
  - API: `POST /v1/players`, `GET /v1/players/{id}/status`, `POST /v1/players/{id}/limits`, `POST /v1/players/{id}/exclusions`, `POST /v1/stake-authorizations`, `GET /v1/events` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
