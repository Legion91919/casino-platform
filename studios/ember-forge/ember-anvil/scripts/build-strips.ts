// Builds the reel strips from symbol counts and prints them for src/game.ts.
// Each symbol is spread evenly round the strip (largest count first, collisions move to the next
// free stop), so no reel has long runs of one symbol. Deterministic: same counts, same strips.
// Usage: node scripts/build-strips.ts   (prints strips for src/game.ts and the exact RTP they give)
import { buildStrips as buildKilnStrips } from "@ember-forge/kiln/math";
import { exactLineRtp } from "@ember-forge/kiln/math/rtp";
import { config } from "../src/game.ts";

export const STRIP_LENGTH = 32;

// Counts per reel (each row sums to 32). These are the tuning knobs for RTP and volatility.
export const STRIP_COUNTS: Record<string, number>[] = [
  { ember: 2, crucible: 1, anvil: 2, hammer: 2, tongs: 3, ingot: 4, ruby: 6, jade: 6, rivet: 6 },
  { ember: 3, crucible: 1, anvil: 2, hammer: 2, tongs: 3, ingot: 4, ruby: 5, jade: 6, rivet: 6 },
  { ember: 4, crucible: 1, anvil: 2, hammer: 3, tongs: 3, ingot: 4, ruby: 5, jade: 5, rivet: 5 },
  { ember: 3, crucible: 1, anvil: 2, hammer: 3, tongs: 3, ingot: 4, ruby: 5, jade: 5, rivet: 6 },
  { ember: 2, crucible: 1, anvil: 2, hammer: 3, tongs: 3, ingot: 4, ruby: 5, jade: 6, rivet: 6 },
];

export function buildStrips(): string[][] {
  return buildKilnStrips(STRIP_COUNTS, STRIP_LENGTH, 5);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const strips = buildStrips();
  const r = exactLineRtp({ ...config, strips });
  console.log(`exact RTP ${(r.rtp * 100).toFixed(4)}% (${r.rtpBps} bps)`);
  console.log("export const STRIPS: readonly (readonly string[])[] = [");
  for (const s of strips) console.log(`  [${s.map((x) => JSON.stringify(x)).join(",")}],`);
  console.log("];");
}
