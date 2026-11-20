# Backlog: Cashier

## Now
- [ ] **Slice 1**: A game server can debit a stake and credit a win for a player in a hosted wallet, exactly once, only after Pitboss approves, and the ledger balances.
  - Given a funded player (100.00 EUR) and a valid game-session token, when the game server debits 2.50 with transaction id gs-100, then the response is accepted with cash balance 97.50, one round is open and the posting sums to zero.
  - Given gs-100 was accepted, when the same request is sent again, then the stored response is returned with `Idempotent-Replay: true` and the balance is still 97.50.
  - Given gs-100 was accepted, when a request with id gs-100 but a different amount arrives, then 409 IDEMPOTENCY_CONFLICT is returned and nothing moves.
  - Given Pitboss denies the stake (player excluded) or does not answer within 150 ms, when the debit arrives, then it is rejected (PLAYER_EXCLUDED / RG_UNAVAILABLE), the rejection is stored, and a retry returns the same rejection.
  - Given an open round, when the game server credits 6.00 with closeRound=true, then the balance is 103.50, the round is closed, and BetPlaced and BetSettled are in the outbox in the same transactions as the postings.
  - Given a rollback for a stake id never seen, when the stake arrives later, then the stake is refused (tombstone) and the balance never changed.
  - Test notes: Unit: posting builder, round state machine, idempotency decision table. Integration (Testcontainers PostgreSQL 16): concurrent duplicate debits (50 parallel requests, one posting). DB tests: `db/tests/*.sql`. Contract: BetPlaced/BetSettled validate against `contracts/events`. Property test: random sequences of debit/credit/rollback/retry keep sum(ledger)=0 and balance = sum(player entries).
  - API: `GET /v1/wallet/balance`, `POST /v1/wallet/debit`, `POST /v1/wallet/credit`, `POST /v1/wallet/rollback`, `POST /v1/transfers`, `POST /v1/bonus-credits`, `GET /v1/events` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
