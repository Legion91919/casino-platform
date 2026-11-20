# Key flows

The suite is API-first (operators own the player UI). Each step names the API call it uses.
Sequence diagrams for flows 1, 3 and the risky variants are in `docs/DESIGN.md` §6.

1. **Play a round** (player, via operator and game server)
   1. Operator `POST dealer /v1/launches` → Dealer checks `GET pitboss /v1/players/{id}/status`, resolves the build.
   2. Game server `POST dealer /v1/launch-sessions/redeem` → game-session token.
   3. Game server `POST cashier /v1/wallet/debit` → Cashier `POST pitboss /v1/stake-authorizations` → ledger posting + BetPlaced.
   4. Game server `POST cashier /v1/wallet/credit {closeRound}` → posting + BetSettled.
   5. Comps, Countroom, Pitboss read `GET cashier /v1/events`.
2. **Protect a player** (operator on the player's behalf)
   1. `POST pitboss /v1/players` (register, KYC outcome).
   2. `POST pitboss /v1/players/{id}/limits` (lower now, raise after the jurisdiction delay).
   3. `POST pitboss /v1/players/{id}/exclusions` → PlayerExcluded → Dealer revokes sessions, Comps forfeits bonuses.
3. **Release a game** (studio, compliance, release manager, on-call)
   1. Studio CI `POST dealer /v1/games/{gameCode}/builds`.
   2. Compliance `POST dealer /v1/builds/{buildId}/certifications`.
   3. Release `POST dealer /v1/rollouts` (10% canary, then 100%) → GameReleased.
   4. On-call `POST dealer /v1/kill-switches` if health telemetry turns red → GameKilled.
4. **Run a bonus** (operator CRM)
   1. `POST comps /v1/campaigns`; 2. `POST comps /v1/awards` → `POST cashier /v1/bonus-credits`; 3. wagering from BetSettled; 4. completion or expiry → Cashier convert/forfeit.
5. **Report to the regulator** (compliance)
   1. Nightly GGR rebuild; 2. `POST countroom /v1/exports`; 3. `GET countroom /v1/exports/{id}` → sealed file with checksum.
6. **Start a new service** (platform or studio engineer)
   1. `POST backstage /v1/services` (golden path, Baton included); 2. CI posts `POST backstage /v1/scorecard-results`; 3. merge bot posts `POST backstage /v1/change-records`.
