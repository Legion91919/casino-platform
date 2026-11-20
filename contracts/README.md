# Contracts

Cross-team contracts live here, owned jointly (CODEOWNERS: the producing team plus `team-backstage`).
A change to a file in this folder needs approval from the producer **and** every consuming team listed below.

## How events travel (suite ADR-0003)
Each producer writes events into its own `outbox` table in the same transaction as the state change.
Consumers poll the producer's `GET /v1/events?after=<cursor>` feed, record each `eventId` in their own
`inbox` table (at-most-once processing on top of at-least-once delivery), and store their cursor in
`consumer_checkpoint`. There is no broker yet. The cursor is `(tx_id, position)` and the feed only
serves rows whose transaction is older than every in-flight one, so a slow commit is never skipped.

## Events

| Event | Publisher | Consumers (and why) | Partition key |
|---|---|---|---|
| `BetPlaced` v1 | cashier | countroom (open exposure), pitboss (session activity for reality checks) | externalRoundId |
| `BetSettled` v1 | cashier | countroom (bet facts, GGR), comps (wagering progress), pitboss (net-loss usage), catwalk (wallet check on each round in a player's history) | externalRoundId |
| `RoundVoided` v1 | cashier | countroom (void facts), pitboss (refund net loss) | externalRoundId |
| `SettlementReversed` v1 | cashier | countroom (restate the business day), comps (hold the award for review), pitboss (adjust loss usage) | externalRoundId |
| `LimitBreached` v1 | pitboss | countroom (responsible-gambling intervention report), operators via webhook | playerId |
| `PlayerExcluded` v1 | pitboss | comps (forfeit bonuses, stop awards), dealer (revoke launch sessions), countroom (RG report), operators via webhook | playerId |
| `GameReleased` v1 | dealer | countroom (game dimension), comps (free-spin eligible games), backstage (catalogue) | gameCode |
| `GameKilled` v1 | dealer | comps (pause free spins on the game), countroom (incident annotation), cashier (void open rounds of the game after grace period) | gameCode |
| `BonusAwarded` v1 | comps | countroom (bonus liability) | playerId |
| `BonusCompleted` v1 | comps | countroom (bonus cost into NGR) | playerId |
| `RoundOutcomeRecorded` v1 | studio game servers (signed) | catwalk (player round history and replay) | roundId |
| `BonusExpired` v1 | comps | countroom (forfeited bonus); the balance itself is forfeited by Comps' synchronous call to Cashier first | playerId |

Every event uses `envelope.v1.schema.json`: `eventId`, `eventType`, `schemaVersion`, `occurredAt`,
`producer`, `operatorCode` (tenant), `partitionKey`, optional `traceparent`, and `data`.

## Events from outside the platform
Studio game servers are run by other companies, so their events cross a trust boundary. A studio
signs `RoundOutcomeRecorded.data` with Ed25519 (canonical JSON: sorted keys, no whitespace, integers
only) using a key it registered at Dealer (`PUT /v1/studios/{studioCode}/signing-keys/{kid}`).
Catwalk verifies every round against those keys and quarantines anything that does not verify.
The envelope's `producer` is `studio`; `data.studioCode` says which one.

## Rules for the data in events
- **Money** is `{ "amountMinor": <integer>, "currency": "EUR" }`. Floats are rejected by the schema.
- **Personal data**: only the pseudonymous `playerId` (marked `x-personal-data`). No names, emails,
  dates of birth or document numbers ever go into an event. Countroom re-keys `playerId` with an HMAC on arrival.
- **Commands are not events.** Money moves between services (Comps asking Cashier to credit a bonus)
  are synchronous, idempotent API calls, not events. Events report what already happened.

## Versioning rules
1. **Additive change** (a new optional field, a new enum value consumers may ignore): same
   `schemaVersion`, schema updated in the same PR as the producer change. Consumers are tolerant
   readers: they ignore unknown fields and treat unknown enum values as "other".
2. **Breaking change** (rename, removal, type or meaning change, a new required field): new file
   `<event>.v2.schema.json`, `schemaVersion: 2`. The producer **dual-publishes v1 and v2** for at least
   one release cycle (default 30 days) until every consumer in the table above has moved; then v1 is retired.
3. A field's **meaning** never changes under the same name, even if its type stays the same.
4. Producers validate every outgoing event against the schema in their contract tests; consumers run
   the `examples/*.valid.json` files through their handlers in theirs (consumer-driven contract tests).
5. `tools/validate-contracts.py` runs in CI: schemas are valid, valid examples pass, invalid examples
   fail (float money, a player name, a missing field, a wrong producer), every OpenAPI file is valid
   3.1, and this table matches the schema files.

## Synchronous APIs
Each service's OpenAPI 3.1 file is at `services/<name>/api/openapi.yaml`. Breaking changes follow the
same rule: a new path version (`/v2/...`) served alongside `/v1` until consumers move.
