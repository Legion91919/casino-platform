// A small game used only by Kiln's own tests, so the framework is tested without any real game.
import { buildStrips, createLineGame, type FeatureRules, type LineGameConfig } from "../../src/math/index.ts";

const counts = { w: 2, a: 3, b: 4, c: 5, s: 1, x: 5 };
export const fixtureConfig: LineGameConfig = {
  id: "fixture", version: 1, reels: 5, rows: 3,
  symbols: ["w", "a", "b", "c", "s", "x", "held"], wild: "w", extraWilds: ["held"], scatter: "s",
  lines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]],
  paytable: { w: [20, 100, 500], a: [10, 40, 100], b: [5, 20, 50], c: [3, 10, 25], x: [2, 5, 10] },
  scatterPays: [2, 10, 50],
  strips: buildStrips(Array(5).fill(counts), 20, 3),
  lineBetsMinor: [1, 2, 5, 10, 20, 50],
  maxSteps: 1,
};
export const fixtureMath = createLineGame(fixtureConfig);

/** Feature fixture: every "a" on reel 3 becomes a wild held for 1 more spin. */
export const holdRules: FeatureRules = {
  afterLanding({ grid, held }) {
    const out = grid.map((c) => [...c]);
    const isHeld = new Set(held.map((h) => `${h.reel}:${h.row}`));
    const hold = [] as { reel: number; row: number; symbol: string; spinsLeft: number }[];
    const transforms = [];
    for (let row = 0; row < 3; row++) {
      if (grid[2]![row] === "a" && !isHeld.has(`2:${row}`)) {
        out[2]![row] = "held";
        hold.push({ reel: 2, row, symbol: "held", spinsLeft: 1 });
        transforms.push({ kind: "freeze", by: [[2, row]] as [number, number][], cells: [[2, row]] as [number, number][], into: "held", holdSpins: 1 });
      }
    }
    return { grid: out, transforms, hold, winMultiplier: 1 };
  },
};
export const featureMath = createLineGame({ ...fixtureConfig, id: "fixture-features", maxSteps: 4 }, holdRules);
