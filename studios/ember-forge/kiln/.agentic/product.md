# Kiln: product

**Users:** Ember Forge's game teams (math designer, client developer, artist, back-end).
**Job:** ship a new certified slot in weeks, where only the parts that make the game different are new.

## A new game writes
1. `src/game.ts`: strips, lines, paytable, line bets (and `DECLARED_RTP_BPS` if it has features).
2. `src/rules.ts` (optional): a `FeatureRules.afterLanding` that transforms the landed grid, holds wilds, sets a multiplier.
3. `src/definition.ts` + `src/theme.css`: title, palette, fonts, words.
4. `src/presenter.ts` (optional): tween.js animations for its rules.
5. `art/`: one sprite per symbol plus a background (generated PNGs or SVG placeholders).

## Kiln guarantees
- The RNG's only output is reel stops per spin; everything else is derived, so any round replays from its stops.
- A round (including all free respins) is drawn and frozen before money moves; payment is retryable, the result is not.
- One maths code path for server, replay and RTP: what is certified is what runs.
- Builds are immutable and fully hashed in the manifest; Dealer refuses a slot without a replay renderer.
- Controls are accessible HTML; the canvas respects reduced motion.
