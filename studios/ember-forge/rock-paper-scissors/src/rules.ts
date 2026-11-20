// Land of Rock Paper Scissors feature rules. Pure: the server, the replay renderer and the RTP
// simulation all run this same code. All three interactions are read from the grid as it landed,
// at the same moment, so the order they are listed in never changes the result.
//
//   Paper wraps rock      a paper next to a rock wraps it: the rock becomes a WRAPPED wild,
//                         held for 1 more spin (a free respin).
//   Scissors cut paper    scissors next to a paper cut it in two: the paper's cell and one cell
//                         beside it (below, else above) become TORN wilds, held for 2 more spins.
//   Rock smashes scissors each rock-scissors pair adds +1 to the spin's win multiplier (max x5).
//
// "Next to" means sharing an edge: left, right, above or below. Wilds already held never interact.
import type { CellRef, FeatureRules, HeldCell, Sym, Transform } from "@ember-forge/kiln/math";

export const ROCK = "rock", PAPER = "paper", SCISSORS = "scissors";
export const WRAPPED = "wrapped", TORN = "torn";
export const WRAP_HOLD = 1, CUT_HOLD = 2, MAX_MULTIPLIER = 5;
export const RULES_VERSION = "rps-rules-1";

const neighbours = (reel: number, row: number, reels: number, rows: number): CellRef[] =>
  ([[reel - 1, row], [reel + 1, row], [reel, row - 1], [reel, row + 1]] as CellRef[]).filter(([r, w]) => r >= 0 && r < reels && w >= 0 && w < rows);

export const rpsRules: FeatureRules = {
  afterLanding({ grid, held, config }) {
    const { reels, rows } = config;
    const isHeld = new Set(held.map((h) => `${h.reel}:${h.row}`));
    const at = (r: number, w: number) => (isHeld.has(`${r}:${w}`) ? undefined : grid[r]![w]);
    const transforms: Transform[] = [];
    const out = grid.map((c) => [...c]);
    const hold = new Map<string, HeldCell>();
    const holdCell = (reel: number, row: number, symbol: Sym, spins: number) => {
      const k = `${reel}:${row}`;
      if ((hold.get(k)?.spinsLeft ?? 0) < spins) hold.set(k, { reel, row, symbol, spinsLeft: spins });
      out[reel]![row] = symbol;
    };
    let smashes = 0;

    for (let reel = 0; reel < reels; reel++) {
      for (let row = 0; row < rows; row++) {
        const s = at(reel, row);
        const near = neighbours(reel, row, reels, rows);
        if (s === ROCK) {
          const papers = near.filter(([r, w]) => at(r, w) === PAPER);
          if (papers.length) transforms.push({ kind: "wrap", by: papers, cells: [[reel, row]], into: WRAPPED, holdSpins: WRAP_HOLD });
          // count each rock-scissors pair once, from the rock's side
          for (const [r, w] of near) if (at(r, w) === SCISSORS) { smashes++; transforms.push({ kind: "smash", by: [[reel, row]], cells: [[r, w]] }); }
        }
        if (s === PAPER) {
          const blades = near.filter(([r, w]) => at(r, w) === SCISSORS);
          if (blades.length) {
            const below: CellRef = [reel, row + 1], above: CellRef = [reel, row - 1];
            const free = (c: CellRef) => c[1] >= 0 && c[1] < rows && !isHeld.has(`${c[0]}:${c[1]}`);
            const half = free(below) ? below : free(above) ? above : null;
            const cells: CellRef[] = half ? [[reel, row], half] : [[reel, row]];
            transforms.push({ kind: "cut", by: blades, cells, into: TORN, holdSpins: CUT_HOLD });
          }
        }
      }
    }
    // Apply after reading everything: wraps then cuts, a cut wins where both touch a cell (longer hold).
    for (const t of transforms) if (t.kind === "wrap") for (const [r, w] of t.cells) holdCell(r, w, WRAPPED, WRAP_HOLD);
    for (const t of transforms) if (t.kind === "cut") for (const [r, w] of t.cells) holdCell(r, w, TORN, CUT_HOLD);
    return { grid: out, transforms, hold: [...hold.values()], winMultiplier: Math.min(1 + smashes, MAX_MULTIPLIER) };
  },
};
