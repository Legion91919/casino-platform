// Payline evaluation shared by every Kiln game.
import type { CellRef, LineGameConfig, LineResult, Sym } from "./types.ts";

export function gridFor(stops: readonly number[], c: LineGameConfig): Sym[][] {
  if (stops.length !== c.reels) throw new RangeError(`need ${c.reels} stops, got ${stops.length}`);
  return stops.map((stop, reel) => {
    const strip = c.strips[reel]!;
    if (!Number.isInteger(stop) || stop < 0 || stop >= strip.length) throw new RangeError(`stop ${stop} is off reel ${reel + 1}`);
    return Array.from({ length: c.rows }, (_, row) => strip[(stop + row) % strip.length]!);
  });
}

/** Best pay for one line read left to right: a leading run of wilds pays on its own if that beats the symbol it completes. */
export function payLine(symbols: readonly Sym[], c: LineGameConfig): { symbol: Sym; count: number; multiplier: number } {
  const blocked = new Set([...(c.noSubstitute ?? []), ...(c.scatter ? [c.scatter] : [])]);
  const pay = (s: Sym, n: number) => (n >= 3 ? c.paytable[s]?.[n - 3] ?? 0 : 0);
  const isWild = (x: Sym | undefined) => x === c.wild || (c.extraWilds?.includes(x as Sym) ?? false);
  let wilds = 0;
  while (wilds < symbols.length && isWild(symbols[wilds])) wilds++;
  const wildPay = pay(c.wild, wilds);
  if (wilds === symbols.length) return { symbol: c.wild, count: wilds, multiplier: wildPay };
  const base = symbols[wilds]!;
  if (blocked.has(base)) return { symbol: c.wild, count: wilds, multiplier: wildPay };
  let count = wilds;
  while (count < symbols.length && (symbols[count] === base || isWild(symbols[count]))) count++;
  const basePay = pay(base, count);
  return basePay >= wildPay ? { symbol: base, count, multiplier: basePay } : { symbol: c.wild, count: wilds, multiplier: wildPay };
}

export function evaluateLines(grid: Sym[][], c: LineGameConfig): LineResult[] {
  const wins: LineResult[] = [];
  c.lines.forEach((rows, i) => {
    const p = payLine(rows.map((row, reel) => grid[reel]![row]!), c);
    if (p.multiplier > 0) wins.push({ line: i + 1, ...p, positions: rows.slice(0, p.count).map((row, reel): CellRef => [reel, row]) });
  });
  return wins;
}

export function countScatters(grid: Sym[][], c: LineGameConfig): { count: number; multiplier: number } {
  if (!c.scatter || !c.scatterPays) return { count: 0, multiplier: 0 };
  const count = grid.reduce((n, col) => n + col.filter((s) => s === c.scatter).length, 0);
  return { count, multiplier: count >= 3 ? c.scatterPays[Math.min(count, 5) - 3]! : 0 };
}
