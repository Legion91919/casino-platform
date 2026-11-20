// Ember Anvil, version 1: everything a test lab certifies. No features, so its RTP is exact.
import { createLineGame, type LineGameConfig } from "@ember-forge/kiln/math";

export const STUDIO = "ember-forge";
export const GAME = "ember-anvil";
export const FEATURE_RULES = "none";

// Reel strips (32 stops each, one scatter per strip), generated from the counts in
// scripts/build-strips.ts; the counts are what tune the RTP. Never edit by hand.
export const STRIPS: readonly (readonly string[])[] = [
  ["rivet","hammer","jade","ruby","crucible","rivet","ingot","tongs","jade","ruby","anvil","rivet","ember","jade","ruby","ingot","rivet","tongs","jade","ruby","hammer","rivet","ingot","anvil","jade","ruby","ember","rivet","tongs","jade","ruby","ingot"],
  ["rivet","ruby","jade","ingot","ember","rivet","tongs","jade","ruby","hammer","rivet","ingot","ember","jade","ruby","tongs","rivet","anvil","jade","ingot","ruby","rivet","ember","jade","hammer","tongs","rivet","ruby","ingot","jade","crucible","anvil"],
  ["jade","ruby","ingot","rivet","tongs","crucible","jade","ruby","ember","rivet","ingot","hammer","ruby","jade","tongs","ember","rivet","anvil","ingot","jade","ruby","hammer","rivet","ember","tongs","ruby","jade","ingot","anvil","rivet","hammer","ember"],
  ["ember","rivet","jade","hammer","ingot","ruby","tongs","rivet","jade","anvil","crucible","ruby","rivet","ingot","jade","ember","hammer","rivet","ruby","tongs","ingot","jade","ember","rivet","ruby","hammer","anvil","jade","rivet","ingot","ruby","tongs"],
  ["anvil","jade","ingot","ruby","rivet","hammer","jade","ember","tongs","rivet","ruby","ingot","jade","crucible","anvil","rivet","ruby","jade","ingot","hammer","rivet","tongs","jade","ruby","ember","rivet","ingot","hammer","jade","ruby","tongs","rivet"],
];

export const config: LineGameConfig = {
  id: GAME,
  version: 1,
  reels: 5,
  rows: 3,
  symbols: ["ember", "crucible", "anvil", "hammer", "tongs", "ingot", "ruby", "jade", "rivet"],
  wild: "ember",
  scatter: "crucible",
  lines: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1],
  ],
  paytable: {
    ember: [50, 250, 1000], anvil: [25, 100, 400], hammer: [15, 60, 200], tongs: [10, 40, 120],
    ingot: [8, 25, 80], ruby: [5, 15, 50], jade: [4, 12, 40], rivet: [3, 10, 30],
  },
  scatterPays: [2, 10, 50],
  strips: STRIPS,
  lineBetsMinor: [1, 2, 5, 10, 20, 50],
  maxSteps: 1,
};

export const math = createLineGame(config);
