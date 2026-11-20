// Land of Rock Paper Scissors, version 1: everything a test lab certifies.
// Features make rounds depend on earlier spins (held wilds, free respins), so RTP is established by
// seeded simulation with its standard error (scripts/par-sheet.ts), not by enumeration.
import { createLineGame, type LineGameConfig } from "@ember-forge/kiln/math";
import { RULES_VERSION, rpsRules, TORN, WRAPPED } from "./rules.ts";
import { STRIPS } from "./strips.ts";

export const STUDIO = "ember-forge";
export const GAME = "rps-land";
export const FEATURE_RULES = RULES_VERSION;
/** Declared to Dealer; scripts/par-sheet.ts simulates 5M rounds (95.65%, standard error 0.09) and the tests check it statistically. */
export const DECLARED_RTP_BPS = 9565;

export const config: LineGameConfig = {
  id: GAME,
  version: 1,
  reels: 5,
  rows: 3,
  symbols: ["crane", "rock", "paper", "scissors", "sun", "moon", "star", "cloud", WRAPPED, TORN],
  wild: "crane",
  extraWilds: [WRAPPED, TORN],
  lines: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1],
  ],
  paytable: {
    crane: [40, 200, 800], rock: [20, 80, 300], paper: [15, 60, 200], scissors: [12, 50, 150],
    sun: [6, 20, 60], moon: [4, 15, 50], star: [4, 12, 40], cloud: [3, 10, 30],
  },
  strips: STRIPS,
  lineBetsMinor: [1, 2, 5, 10, 20, 50],
  maxSteps: 8,
};

export const math = createLineGame(config, rpsRules);
