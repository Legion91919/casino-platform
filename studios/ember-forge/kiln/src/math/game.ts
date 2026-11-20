// The round loop every Kiln game shares: land, apply feature rules, pay, then respin while any
// wild is held. Used live (stops from the RNG) and in replays (stops from the record), so a replay
// re-derives exactly the same round.
import { countScatters, evaluateLines, gridFor } from "./lines.ts";
import type { FeatureRules, GameMath, HeldCell, LineGameConfig, RoundResult, StepResult } from "./types.ts";

export function createLineGame(config: LineGameConfig, features?: FeatureRules): GameMath {
  validate(config);
  const maxSteps = config.maxSteps ?? 1;
  return {
    config,
    playRound(nextStops, lineBetMinor) {
      if (!Number.isSafeInteger(lineBetMinor) || lineBetMinor <= 0) throw new RangeError("line bet must be a positive integer");
      const steps: StepResult[] = [];
      let held: HeldCell[] = [];
      for (let step = 0; step < maxSteps; step++) {
        const stops = nextStops(step);
        const landed = gridFor(stops, config);
        for (const h of held) landed[h.reel]![h.row] = h.symbol;
        const f = features
          ? features.afterLanding({ grid: landed.map((c) => [...c]), held, step, config })
          : { grid: landed.map((c) => [...c]), transforms: [], hold: [], winMultiplier: 1 };
        const lineWins = evaluateLines(f.grid, config);
        const sc = countScatters(f.grid, config);
        const lineSum = lineWins.reduce((s, w) => s + w.multiplier, 0);
        const winMinor = lineSum * lineBetMinor * f.winMultiplier + sc.multiplier * lineBetMinor * config.lines.length;
        steps.push({ step, stops: [...stops], landed, held, transforms: f.transforms, final: f.grid, lineWins, scatterCount: sc.count, scatterMultiplier: sc.multiplier, winMultiplier: f.winMultiplier, winMinor });
        // carry over: cells still held from before (one spin used) merged with newly held cells
        const next = new Map<string, HeldCell>();
        for (const h of held) if (h.spinsLeft - 1 > 0) next.set(`${h.reel}:${h.row}`, { ...h, spinsLeft: h.spinsLeft - 1 });
        for (const h of f.hold) {
          const k = `${h.reel}:${h.row}`;
          const prev = next.get(k);
          if (!prev || prev.spinsLeft < h.spinsLeft) next.set(k, h);
        }
        held = [...next.values()].sort((a, b) => a.reel - b.reel || a.row - b.row);
        if (held.length === 0) break;
      }
      return { steps, totalWinMinor: steps.reduce((s, x) => s + x.winMinor, 0) };
    },
  };
}

function validate(c: LineGameConfig) {
  if (c.strips.length !== c.reels) throw new Error(`${c.id}: ${c.strips.length} strips for ${c.reels} reels`);
  for (const l of c.lines) if (l.length !== c.reels || l.some((r) => r < 0 || r >= c.rows)) throw new Error(`${c.id}: bad payline ${l}`);
  const known = new Set(c.symbols);
  for (const s of c.strips.flat()) if (!known.has(s)) throw new Error(`${c.id}: unknown symbol ${s} on a strip`);
}

/** Flattens a round into the RoundOutcomeRecorded outcome shape (contracts/events). */
export function toOutcome(r: RoundResult, lineBetMinor: number, currency: string, lineCount: number) {
  const money = (amountMinor: number) => ({ amountMinor, currency });
  const first = r.steps[0]!;
  return {
    stops: first.stops,
    grid: first.final,
    lineWins: r.steps.flatMap((s) => s.lineWins.map((w) => ({
      line: w.line, symbol: w.symbol, count: w.count, positions: w.positions, step: s.step,
      win: money(w.multiplier * lineBetMinor * s.winMultiplier),
    }))),
    scatter: {
      count: first.scatterCount,
      win: money(r.steps.reduce((t, s) => t + s.scatterMultiplier * lineBetMinor * lineCount, 0)),
    },
    steps: r.steps.map((s) => ({
      step: s.step, stops: s.stops, grid: s.final, landed: s.landed, held: s.held, transforms: s.transforms,
      winMultiplier: s.winMultiplier, win: money(s.winMinor),
    })),
  };
}

export type KilnOutcome = ReturnType<typeof toOutcome>;
