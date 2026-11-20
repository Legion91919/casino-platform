import { writeParSheet } from "@ember-forge/kiln/tools/par-sheet";
import { FEATURE_RULES, math } from "../src/game.ts";

const r = writeParSheet({ file: new URL("../docs/par-sheet.md", import.meta.url), title: "Ember Anvil", version: "1.0.0", math, featureRules: FEATURE_RULES, spins: 1_000_000 });
console.log(`PAR sheet written: exact RTP ${((r.exact?.rtp ?? 0) * 100).toFixed(4)}%, hit rate ${(r.sim.hitRate * 100).toFixed(2)}%`);
