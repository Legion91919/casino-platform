# Kiln: Ember Forge's slot framework

Ember Forge Studio (invented) builds every slot on Kiln. A game is **config + rules + art**;
Kiln supplies the rest, from the certified math loop to the WebGL reels and the replay Catwalk embeds.

| Layer | What Kiln gives a game | Where |
|---|---|---|
| Math engine | `createLineGame(config, featureRules?)`: paylines, wilds (plus feature wilds), scatters, and a round loop with **held wilds and free respins**. Pure, deterministic, browser-safe. | `src/math/` |
| RTP tools | `exactLineRtp` (full-cycle, for games without features, proved against brute force), `simulateRtp` (seeded, with standard error, for feature games), PAR-sheet writer | `src/math/rtp.ts`, `scripts/par-sheet.ts` |
| Server kit | `runGameServer`: launch redemption, idempotent spins that **draw the whole round, freeze it, then pay**, a background resumer, signed `RoundOutcomeRecorded` events through a Postgres outbox | `src/server/`, `db/` |
| Client | `startGame(definition)`: PixiJS stage at a fixed design resolution, a reel set that spins by scrolling a symbol sequence (rows + 1 sprites per reel), held-wild overlay with spin counters, win lines and pulses, rolling win counter, all animated with tween.js; accessible HTML controls over the canvas | `src/client/` |
| Feature presenters | A game's `FeaturePresenter` animates its own rules on Kiln's sprites (wraps, cuts, smashes in Land of Rock Paper Scissors) | the game's `src/presenter.ts` |
| Replay | `startReplay(definition)`: re-plays a recorded round from its stops with the build's own math, tells Catwalk whether it matches, then animates it | `src/client/replay-client.ts` |
| Build | `scripts/build-game.ts <game>`: esbuild bundles, a **sprite atlas** baked from `art/*.png` or `.svg` (sharp), background, fonts, pages, and the Dealer manifest (asset hashes, RTP, math hash, replay entrypoint) | `scripts/` |
| Art import | `scripts/import-art.ts`: cuts a generated sprite sheet (or single images) into trimmed, squared sprites | `scripts/` |

```text
game folder                         Kiln
  src/game.ts      config + math --> createLineGame --> playRound(nextStops)   (server, replay, RTP)
  src/rules.ts     FeatureRules  --^
  src/definition.ts theme, words --> startGame / startReplay (PixiJS + tween.js)
  src/presenter.ts animations    --^
  art/*.png|svg    sprites       --> build-game: atlas.png + atlas.json + manifest.json
  src/server.ts                  --> runGameServer (wallet, freeze-then-pay, signed outbox)
```

**Games on Kiln:** [Ember Anvil](../ember-anvil) (no features, exact RTP 96.39%) and
[Land of Rock Paper Scissors](../rock-paper-scissors) (sticky wilds, respins, multipliers; simulated RTP 95.65%).

**Proof:** `npm test` here: 26 tests (paylines, feature wilds, exact RTP = brute force, held wilds
and respin cap, replay determinism, outcome sums, every wallet failure path, 10 concurrent retries on
Postgres). The shared game-server schema has 13 DB assertions in `tools/db-verify.sh`.

Why PixiJS and tween.js, and why the HUD is HTML: `.agentic/decisions/0001-client-stack.md`.
