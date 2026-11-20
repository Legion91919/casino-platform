# Land of Rock Paper Scissors (sample studio game)

By Ember Forge Studio (invented), built on [Kiln](../kiln). Five reels, three rows, ten lines,
paper cranes are wild, and the three hands interact wherever they land **next to each other**
(left, right, above or below):

| Rule | What happens | Held for |
|---|---|---|
| **Paper wraps rock** | The rock becomes a *wrapped* wild | 1 free respin |
| **Scissors cut paper** | The paper becomes two *torn* wilds (its cell and the one below, or above on the bottom row) | 2 free respins |
| **Rock smashes scissors** | +1 to that spin's win multiplier for each pair | up to x5 |

All three are read from the grid **as it landed, at the same moment**, so the order never changes the
result. Respins are free and belong to the same paid round (capped at 8 spins), which keeps every round
independent for certification and replayable in Catwalk. Held wilds never interact again.

**RTP 95.65%** by seeded simulation of 5 million rounds (standard error 0.09 points), because held wilds
make each spin depend on the last. A feature lands in about 1 round in 13. [PAR sheet](docs/par-sheet.md).

| Path | What |
|---|---|
| `src/rules.ts` | the three rules as one Kiln `FeatureRules` (pure, shared by server, replay and simulation) |
| `src/game.ts`, `src/strips.ts` | strips, lines, pays, declared RTP |
| `src/presenter.ts` | tween.js animations: the paper flies onto the rock, scissors snip, the paper splits, the rock lunges |
| `src/definition.ts`, `src/theme.css` | papercraft theme, words |
| `art/` | placeholder vector art; generated PNGs with the same names replace it (see `../docs-art-prompts.md`) |
| `test/rules.test.ts` | each rule on scripted screens, combinations, respin cap, replay, declared RTP |

`npm test` · `npm run build` · `npm run par` · play it with everything else: `npm run floor` at the repo root.
