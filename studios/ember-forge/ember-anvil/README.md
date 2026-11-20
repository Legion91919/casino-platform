# Ember Anvil (sample studio game)

By Ember Forge Studio (invented), built on [Kiln](../kiln), the studio's slot framework. With no
features, the whole game is a config file, a theme and nine sprites; Kiln provides the round loop,
the game server, the PixiJS client and the replay renderer Catwalk embeds.

5 reels x 3 rows · 10 fixed lines · embers wild · crucibles scatter · stakes 0.10 to 5.00 · **RTP 96.39%**

## Layout
| Path | What |
|---|---|
| `src/game.ts` | strips, lines, paytable, line bets: everything certified |
| `src/definition.ts`, `src/theme.css` | forge theme (temper colours of heated steel), words |
| `src/client.ts`, `src/replay.ts`, `src/server.ts` | one-line entry points into Kiln |
| `art/` | symbol art (SVG placeholders; generated PNGs with the same names replace them) |
| `scripts/build-strips.ts`, `scripts/par-sheet.ts` | strips from counts, PAR sheet |
| `docs/par-sheet.md` | exact RTP, symbol shares, hit rate, volatility |

## Commands
```bash
npm test             # RTP locked and exact, strips generated, simulation agrees
npm run build        # dist/client + manifest.json (asset hashes, rtpBps, mathModelSha256, replayEntrypoint)
npm run par          # regenerate docs/par-sheet.md
node scripts/build-strips.ts   # strips from the counts that tune RTP
```
Play it with the rest of the platform from the repo root: `npm run floor`.

Why the game server works this way (decide, freeze, then pay): `.agentic/decisions/0001-game-server-architecture.md`, now implemented once in Kiln.
