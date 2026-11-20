// The RNG port (browser-safe). Production uses cryptoRng from crypto-rng.ts (server only),
// which draws without modulo bias. Tests and the PAR-sheet simulation use a seeded generator
// so their results are repeatable; it is never wired into the game server.
import type { Sym } from "./types.ts";

export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** xoshiro128** with rejection sampling (no modulo bias). For tests and simulation only. */
export function seededRng(seed: number): Rng {
  // splitmix32 to expand the seed into four non-zero words
  let x = seed >>> 0;
  const next32 = () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const s = [next32(), next32(), next32(), next32()];
  const rotl = (v: number, k: number) => ((v << k) | (v >>> (32 - k))) >>> 0;
  const u32 = () => {
    const result = Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    s[2]! ^= s[0]!; s[3]! ^= s[1]!; s[1]! ^= s[2]!; s[0]! ^= s[3]!;
    s[2]! ^= t; s[3] = rotl(s[3]!, 11);
    return result;
  };
  return {
    nextInt(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) throw new RangeError("bad range");
      const limit = 2 ** 32 - (2 ** 32 % maxExclusive); // reject the uneven tail
      let v: number;
      do v = u32(); while (v >= limit);
      return v % maxExclusive;
    },
  };
}

/** One stop per reel: the RNG's entire contribution to a round. */
export function drawStops(rng: Rng, strips: readonly (readonly Sym[])[]): number[] {
  return strips.map((strip) => rng.nextInt(strip.length));
}
