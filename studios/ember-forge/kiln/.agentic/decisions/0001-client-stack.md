# ADR-0001 (Kiln): PixiJS + tween.js for reels and effects, accessible HTML for controls, one round loop for everything

- Status: accepted
- Date: 2026-11-20
- Owner: Ember Forge Studio (invented)

## Context
Slots live inside operator lobbies on mid-range phones. They need smooth reel motion at 60 fps, many
sprites and effects, small downloads, fast start, and a replay of any past round. Studios ship many
games, so the framework, not each game, must carry the hard parts.

## Options considered
| Option | Verdict | Why |
|---|---|---|
| DOM + CSS (the first Ember Anvil) | Rejected | Fine for one simple game; reel scrolling, masks, particles and per-frame effects fight layout, and every game re-solved the same problems |
| Canvas 2D by hand | Rejected | No batching or texture atlases; we'd be writing a renderer |
| **PixiJS 8 (WebGL) + tween.js** | **Chosen** | The usual HTML5 slot renderer: sprite batching from one atlas, masks, filters, small and focused; tween.js is tiny, MIT, framework-free and easy to await |
| Phaser 3 | Rejected | Full game engine (scenes, physics, input) we don't need; heavier bundle for the same renderer underneath |
| Unity WebGL export | Rejected | Multi-megabyte runtime, slow first load in a lobby iframe, poor fit for an HTML accessibility layer |
| GSAP instead of tween.js | Rejected | Excellent, but its licence isn't OSI open source; tween.js is MIT |

## Decision
1. **PixiJS 8, WebGL preferred** (`preference: "webgl"`): every target device has WebGL; WebGPU on low-end phones is still uneven. `pixi.js/unsafe-eval` is loaded so pages keep a strict CSP without `unsafe-eval`, and image decoding stays on the main thread because the CSP forbids blob workers.
2. **tween.js on the Pixi ticker**, wrapped as promises (`await tweens.to(...)`) so feature presenters read top to bottom; reduced motion turns tweens into jumps.
3. **Reels by sequence scrolling:** rows + 1 sprites per reel whose textures follow a scroll position; filler symbols pass, the final column lands, then a small bounce. Held wilds live on an overlay so reels spin underneath them.
4. **HTML for controls, canvas for the show:** buttons, bet, balance and a live region are real HTML over the canvas (keyboard, screen readers, zoom); the canvas is `aria-hidden`.
5. **One round loop** (`createLineGame.playRound(nextStops)`) for the server (RNG stops), the replay (recorded stops) and RTP (seeded stops): certification covers exactly the code that runs.
6. **Art pipeline:** sprites from `art/` (generated PNGs preferred, SVG placeholders allowed) baked into one atlas by `sharp` at build time; one texture means one draw batch and one download.

## Consequences
- About 650 KB of minified JavaScript per game (Pixi is most of it) plus a ~130 KB atlas. Next: code-split Pixi features we do not use and measure first paint on a low-end phone profile.
- Replays run the same Pixi stack, so a Catwalk replay looks exactly like the game.
- Swapping to Phaser or Unity later would mean rewriting the client, not the math or server kits.
