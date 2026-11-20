// Production RNG: the operating system's CSPRNG through node:crypto.randomInt, which draws without
// modulo bias. Server only; never bundled into a browser build.
import { randomInt } from "node:crypto";
import type { Rng } from "./rng.ts";

export const cryptoRng: Rng = { nextInt: (maxExclusive) => randomInt(0, maxExclusive) };
