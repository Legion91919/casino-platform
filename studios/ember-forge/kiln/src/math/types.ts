// Kiln math types. A game is reel strips + paylines + paytable, plus optional feature rules that
// run after each spin lands. The RNG's only output, at every step, is one stop per reel; everything
// else in a round is derived from those stops, which is what makes rounds replayable and checkable.

export type Sym = string;
export type CellRef = [reel: number, row: number];

export interface LineGameConfig {
  id: string;
  version: number; // bump when anything certified changes
  reels: number;
  rows: number;
  symbols: readonly Sym[];
  wild: Sym;
  /** Further symbols that act as wilds (e.g. ones a feature turns cells into); they pay as the main wild. */
  extraWilds?: readonly Sym[];
  scatter?: Sym;
  /** Symbols a wild never stands in for (the scatter always). */
  noSubstitute?: readonly Sym[];
  lines: readonly (readonly number[])[];
  /** Pays per line, times the line bet, for 3, 4 and 5 in a row from reel 1. */
  paytable: Readonly<Record<Sym, readonly [number, number, number]>>;
  /** Scatter pays times the total stake for 3, 4, 5 anywhere. */
  scatterPays?: readonly [number, number, number];
  strips: readonly (readonly Sym[])[];
  lineBetsMinor: readonly number[];
  /** Hard cap on spins in one round (first spin + respins). */
  maxSteps?: number;
}

/** A wild held in place for the next spins of the same round. */
export interface HeldCell {
  reel: number;
  row: number;
  symbol: Sym;
  spinsLeft: number;
}

/** Something a feature did to the grid after it landed (shown and replayed by the client). */
export interface Transform {
  kind: string; // e.g. "wrap", "cut", "smash"
  by: CellRef[]; // cells that caused it
  cells: CellRef[]; // cells changed
  into?: Sym; // what the changed cells became
  holdSpins?: number; // how many further spins they stay
}

export interface LineResult {
  line: number;
  symbol: Sym;
  count: number;
  multiplier: number; // times the line bet, before the step multiplier
  positions: CellRef[];
}

export interface StepResult {
  step: number; // 0 = the paid spin, 1.. = free respins
  stops: number[];
  landed: Sym[][]; // [reel][row] as it landed, with held wilds already in place
  held: HeldCell[]; // wilds that were held during this spin
  transforms: Transform[];
  final: Sym[][]; // after transforms; this grid is paid
  lineWins: LineResult[];
  scatterCount: number;
  scatterMultiplier: number;
  winMultiplier: number; // applied to this step's line wins
  winMinor: number;
}

export interface RoundResult {
  steps: StepResult[];
  totalWinMinor: number;
}

/** Feature hook: inspect the landed grid, transform it, decide what stays held and the multiplier. */
export interface FeatureRules {
  afterLanding(input: { grid: Sym[][]; held: HeldCell[]; step: number; config: LineGameConfig }): {
    grid: Sym[][];
    transforms: Transform[];
    hold: HeldCell[]; // cells to hold for the next spins (spinsLeft counts spins still to come)
    winMultiplier: number;
  };
}

export interface GameMath {
  config: LineGameConfig;
  /** Plays a whole round. `nextStops` supplies the stops for each step: the RNG live, recorded stops in a replay. */
  playRound(nextStops: (step: number) => number[], lineBetMinor: number): RoundResult;
}
