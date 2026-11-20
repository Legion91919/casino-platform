import { writeParSheet } from "@ember-forge/kiln/tools/par-sheet";
import { DECLARED_RTP_BPS, FEATURE_RULES, math } from "../src/game.ts";

const spins = Number(process.argv[2] ?? 5_000_000);
const r = writeParSheet({
  file: new URL("../docs/par-sheet.md", import.meta.url), title: "Land of Rock Paper Scissors", version: "1.0.0", math,
  featureRules: FEATURE_RULES, declaredBps: DECLARED_RTP_BPS, spins,
  notes: "Feature rules (src/rules.ts): paper next to rock wraps it (sticky wild, 1 respin); scissors next to paper cut it into two torn wilds (2 respins); each rock-scissors pair adds +1 to the spin multiplier (max x5). Respins are free and part of the same paid round, capped at 8 spins.",
});
console.log(`PAR sheet written: simulated RTP ${(r.sim.rtp * 100).toFixed(2)}% +/- ${(r.sim.standardError * 100).toFixed(3)}, features ${(r.sim.featureRate * 100).toFixed(1)}%`);
