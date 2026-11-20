# Ember Anvil: product

Ember Forge Studio (invented) builds slots for operators on the Casino Platform.

**Ember Anvil**: 5 reels, 3 rows, 10 fixed lines, line bets 0.01 to 0.50 (stakes 0.10 to 5.00),
embers are wild, crucibles scatter. RTP 96.39%, low-to-medium volatility (PAR sheet in `docs/`).

## Must never happen
- A re-spin: once the reels are decided, retries, crashes and wallet outages can only pay that result.
- A double debit: one roundId is one stake, however many times the client retries.
- A stake on a build Dealer did not launch, or for a player Dealer did not authorise.
- A round in a player's history that differs from what this server decided (rounds are signed).
- Floats near money: integer minor units from the math to the wallet call.

## What the studio ships per release
`dist/client/`: the game, the replay renderer, fonts and `manifest.json` (every asset hashed,
declared RTP, math model hash, replay entrypoint). Dealer stores the manifest and refuses to publish
a slot without a replay renderer.
