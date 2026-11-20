// Return to player. Two tools, used deliberately:
//  * exactLineRtp: for games without features. Exact over the full cycle of stop combinations,
//    by symbol-count enumeration (stops are uniform and reels independent, so a payline sees each
//    reel's symbol frequencies whatever row it uses); scatters by convolving per-reel window counts.
//  * simulateRtp: for games with features (held wilds, respins, multipliers), where the round depends
//    on earlier spins. Seeded, with the standard error, so a declared RTP can be tested statistically.
import { payLine } from "./lines.ts";
import { drawStops, seededRng } from "./rng.ts";
import type { GameMath, LineGameConfig, Sym } from "./types.ts";

export interface ExactRtp { cycle: number; linePayPerCycle: number; scatterPayPerCycle: number; rtp: number; rtpBps: number; bySymbol: Record<string, number> }

export function exactLineRtp(c: LineGameConfig): ExactRtp {
  const counts = c.strips.map((strip) => {
    const m = new Map<Sym, number>();
    for (const s of strip) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  });
  const cycle = c.strips.reduce((p, s) => p * s.length, 1);
  const bySymbolPay = new Map<string, number>();
  let linePay = 0;
  const combo: Sym[] = new Array(c.reels);
  const walk = (reel: number, weight: number) => {
    if (reel === c.reels) {
      const p = payLine(combo, c);
      if (p.multiplier > 0) {
        linePay += weight * p.multiplier;
        bySymbolPay.set(p.symbol, (bySymbolPay.get(p.symbol) ?? 0) + weight * p.multiplier);
      }
      return;
    }
    for (const [sym, n] of counts[reel]!) { combo[reel] = sym; walk(reel + 1, weight * n); }
  };
  walk(0, 1);
  let scatterPay = 0;
  if (c.scatter && c.scatterPays) {
    let dist = [1];
    for (const strip of c.strips) {
      const reelDist: number[] = [];
      strip.forEach((_, stop) => {
        let k = 0;
        for (let r = 0; r < c.rows; r++) if (strip[(stop + r) % strip.length] === c.scatter) k++;
        reelDist[k] = (reelDist[k] ?? 0) + 1;
      });
      const next: number[] = new Array(dist.length + reelDist.length - 1).fill(0);
      dist.forEach((a, i) => reelDist.forEach((b, j) => (next[i + j]! += a * (b ?? 0))));
      dist = next;
    }
    dist.forEach((ways, k) => { if (k >= 3) scatterPay += ways * c.scatterPays![Math.min(k, 5) - 3]!; });
  }
  const total = linePay + scatterPay;
  const bySymbol: Record<string, number> = {};
  for (const [s, p] of bySymbolPay) bySymbol[s] = p / cycle;
  if (c.scatter) bySymbol[c.scatter] = scatterPay / cycle;
  return { cycle, linePayPerCycle: linePay, scatterPayPerCycle: scatterPay, rtp: total / cycle, rtpBps: Math.floor((total * 10_000) / cycle), bySymbol };
}

/** Full cycle by brute force through the real round loop (small strips only): proves exactLineRtp. */
export function bruteForceRtp(game: GameMath): { totalPerCycle: number; cycle: number; rtp: number } {
  const c = game.config;
  const cycle = c.strips.reduce((p, s) => p * s.length, 1);
  if (cycle > 5_000_000) throw new RangeError("cycle too large for brute force");
  let total = 0;
  for (let i = 0; i < cycle; i++) {
    let rest = i;
    const stops = new Array(c.reels).fill(0);
    for (let r = c.reels - 1; r >= 0; r--) { stops[r] = rest % c.strips[r]!.length; rest = Math.floor(rest / c.strips[r]!.length); }
    total += game.playRound(() => stops, 1).totalWinMinor; // line bet 1: win is in line bets
  }
  return { totalPerCycle: total, cycle, rtp: total / (cycle * c.lines.length) };
}

export interface SimStats { spins: number; rtp: number; standardError: number; hitRate: number; sd: number; maxWin: number; featureRate: number; avgSteps: number; buckets: number[] }

/** Seeded simulation of whole rounds. Returns per-unit-stake statistics. */
export function simulateRtp(game: GameMath, spins: number, seed = 1): SimStats {
  const c = game.config, rng = seededRng(seed), lines = c.lines.length;
  let sum = 0, sumSq = 0, hits = 0, max = 0, features = 0, steps = 0;
  const buckets = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < spins; i++) {
    const r = game.playRound(() => drawStops(rng, c.strips), 1);
    const x = r.totalWinMinor / lines;
    sum += x; sumSq += x * x; if (x > 0) hits++; if (x > max) max = x;
    if (r.steps.length > 1 || r.steps[0]!.transforms.length) features++;
    steps += r.steps.length;
    buckets[x === 0 ? 0 : x <= 1 ? 1 : x <= 5 ? 2 : x <= 20 ? 3 : x <= 100 ? 4 : 5]!++;
  }
  const mean = sum / spins, sd = Math.sqrt(Math.max(0, sumSq / spins - mean * mean));
  return { spins, rtp: mean, standardError: sd / Math.sqrt(spins), hitRate: hits / spins, sd, maxWin: max, featureRate: features / spins, avgSteps: steps / spins, buckets };
}
