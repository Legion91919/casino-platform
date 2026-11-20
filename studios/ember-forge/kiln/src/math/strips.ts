// Reel strips from symbol counts. Each symbol is spread evenly round the strip (largest count first,
// collisions move to the next free stop), so a strip has no long runs of one symbol. Deterministic:
// same counts, same strips. The counts are the tuning knobs for RTP and volatility.
import type { Sym } from "./types.ts";

export function buildStrip(counts: Record<Sym, number>, length: number, offset: number): Sym[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total !== length) throw new Error(`counts sum to ${total}, expected ${length}`);
  const strip: (Sym | undefined)[] = new Array(length);
  const order = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  order.forEach(([sym, n], k) => {
    for (let i = 0; i < n; i++) {
      let pos = Math.floor(((i + 0.5) * length) / n + offset + k * 3) % length;
      while (strip[pos] !== undefined) pos = (pos + 1) % length;
      strip[pos] = sym;
    }
  });
  return strip as Sym[];
}

export function buildStrips(countsPerReel: Record<Sym, number>[], length: number, offsetStep = 5): Sym[][] {
  return countsPerReel.map((c, reel) => buildStrip(c, length, reel * offsetStep));
}
