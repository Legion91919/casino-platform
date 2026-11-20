# ADR-0006: Round review: studios sign outcomes, Catwalk compares them with the wallet, the build replays them

- Status: accepted
- Date: 2026-11-20

## Context
Players must be able to review the rounds they played (stake, result, balance after), and operators
must be able to trust that what a player is shown is what the certified game decided and what the
wallet paid. Rounds are decided by studio game servers, which the platform does not run. Money is
recorded by Cashier, which knows amounts but not reels.

## Decision
1. **Studios publish a signed `RoundOutcomeRecorded` event per settled round** from their own outbox
   (same feed shape as every platform producer, ADR-0003). The payload is the RNG's output (reel
   stops), everything derived from it, the money, and the math model hash; it is signed with Ed25519
   over canonical JSON using a key the studio registered at Dealer. Keys rotate (two active at most)
   and are retired, never deleted, so old rounds stay verifiable.
2. **A new service, Catwalk, owns round history** as a read model: it verifies every round, stores it
   append-only, and joins it with Cashier's `BetSettled` to show *confirmed*, *mismatch* or *pending*.
3. **The build replays its own rounds.** Dealer refuses to publish a slot build whose manifest lacks
   `replayEntrypoint` and `mathModelSha256` (V002). Catwalk embeds that renderer in a sandboxed,
   cross-origin iframe; the renderer re-computes the win from the stops with the certified rules and
   reports whether it matches.
4. **The game server decides before it pays.** The outcome is frozen in the studio's database before
   the win is credited; a wallet outage delays the payout but can never cause a re-spin.

## Options considered
| Option | Verdict | Why |
|---|---|---|
| A. Each studio hosts its own history screen; operators link to it | Rejected | Different per studio, can't be compared with the wallet, history disappears if a studio leaves |
| B. Cashier stores reel outcomes next to money | Rejected | Puts game-specific, high-volume blobs in the tier-0 money database and its team's on-call |
| C. Catwalk stores outcomes and renders them generically | Rejected | The platform would have to understand every game's art and rules; a generic picture can't be checked by the certified rules |
| D. Signed outcomes + Catwalk read model + the build's own replay renderer | **Chosen** | Studio-neutral history, tamper evidence across a company boundary, independent wallet check, the certified code re-checks each round |

## Consequences
- One more producer type outside the platform: the envelope's `producer` enum gains `studio`.
- One more consumer of `BetSettled` (Catwalk); Cashier's feed load grows by one reader.
- Studios must ship a replay renderer with every slot build; the sample game shows the pattern in
  about 80 lines because it reuses its own math module.
- A doctored or unsigned round is quarantined and paged, never shown. A wallet mismatch is shown to
  the player as "check needed" and to on-call; nobody can edit either side to hide it.
- Catwalk is written in Node/TypeScript and shares `sdk/studio-sdk` with studios (Catwalk ADR-0001).
