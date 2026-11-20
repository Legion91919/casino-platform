# Backlog: Dealer

## Now
- [ ] **Slice 1**: A studio publishes a build, compliance certifies it for Jurisdiction A, release rolls it out to Kestrel Gaming at 10%, Kestrel launches it and the game server redeems the token; the kill switch stops new launches.
  - Given studio Ember Forge's CI, when it publishes jungle-reels 1.5.0-rc.1 with a manifest and asset hashes, then the build is stored immutably and a second publish of 1.5.0-rc.1 is refused.
  - Given the build is only pending in JUR-B, when release tries to roll it out in JUR-B, then it is refused with NOT_CERTIFIED.
  - Given certification in JUR-A, when release rolls stable 1.4.0 at 90% and the canary at 10% for Kestrel, then players in buckets 90-99 get the canary, others get stable, and GameReleased is emitted.
  - Given a launch request for an allowed player, then the response has a URL with a random token valid for at most 5 minutes, only its hash is stored, and the game server can redeem it exactly once for a signed game-session token.
  - Given the kill switch for the canary build, when a player in bucket 95 launches, then the launch is refused within 5 seconds of activation, and GameKilled is emitted.
  - Given a certificate is revoked, then every active rollout of that build in that jurisdiction is rolled back in the same transaction.
  - Test notes: Unit: rollout bucket arithmetic, kill-switch scope resolution. DB tests: certification gate, 100% cap, immutability, token rules, auto-rollback on revocation. Contract: GameReleased/GameKilled schemas; Cashier verifies a token signed with the published JWKS. E2E: publish -> certify -> rollout -> launch -> redeem.
  - API: `POST /v1/games/{gameCode}/builds`, `POST /v1/builds/{buildId}/certifications`, `POST /v1/rollouts`, `POST /v1/launches`, `POST /v1/launch-sessions/redeem`, `POST /v1/kill-switches`, `GET /.well-known/jwks.json`, `GET /v1/events` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
