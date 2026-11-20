# ADR-0001 (Land of Rock Paper Scissors): sticky wilds as free respins inside one paid round

- Status: accepted
- Date: 2026-11-20

## Context
The design brief: paper wraps rock into a sticky wild for one spin; scissors cut paper into two sticky
wilds that stay for an extra spin; rock smashes scissors for multipliers.

## Options
| Option | Verdict | Why |
|---|---|---|
| Wilds stick into the player's **next paid** spins | Rejected | Rounds stop being independent: the next stake buys a better game, the player can walk away from an earned feature, history and replay need cross-round state, and certification gets harder |
| **Free respins within the same round** while any wild is held | **Chosen** | Every round is self-contained, paid once, frozen whole before payment, and replayable from its stops; the feel ("it stuck!") is the same |
| Exact RTP by enumeration | Rejected for this game | Held positions make the next spin depend on the last; the state space is large. Seeded simulation with a standard error, re-checked by tests with a different seed, is the honest method |

## Details settled in code (`src/rules.ts`)
- "Next to" = shares an edge. All interactions are read from the landed grid at once.
- A cut makes the paper's cell and the cell below torn wilds (above when the paper is on the bottom row).
- Where a wrap and a cut touch the same cell, the longer hold wins.
- Each rock-scissors pair adds +1 to the multiplier, capped at x5. Held wilds never interact.
- A round has at most 8 spins.
