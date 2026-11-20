// Land of Rock Paper Scissors: each interaction, how they combine, and the declared RTP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLineGame, drawStops, seededRng, type Sym } from "@ember-forge/kiln/math";
import { simulateRtp } from "@ember-forge/kiln/math/rtp";
import { config, DECLARED_RTP_BPS, math } from "../src/game.ts";
import { rpsRules } from "../src/rules.ts";

// Builds a game whose strips are the given screens stacked, so step k lands screen k exactly.
function scripted(screens: Sym[][][]) {
  const strips = Array.from({ length: 5 }, (_, reel) => screens.flatMap((s) => s[reel]!));
  const game = createLineGame({ ...config, strips }, rpsRules);
  return game.playRound((k) => Array(5).fill(Math.min(k, screens.length - 1) * 3), 1);
}
// Screens are written row by row (like you see them) and turned into reels.
const screen = (rows: string[]): Sym[][] => {
  const cells = rows.map((r) => r.trim().split(/\s+/));
  return Array.from({ length: 5 }, (_, reel) => cells.map((row) => row[reel]!));
};
const QUIET = screen(["star moon cloud sun star", "moon cloud star moon cloud", "cloud star moon cloud sun"]);

test("paper wraps rock: the rock becomes a wrapped wild for 1 free respin", () => {
  const r = scripted([screen(["paper rock cloud sun star", "moon cloud star moon cloud", "cloud star moon cloud sun"]), QUIET]);
  const t = r.steps[0]!.transforms.find((x) => x.kind === "wrap")!;
  assert.deepEqual(t.cells, [[1, 0]]);
  assert.equal(r.steps[0]!.final[1]![0], "wrapped");
  assert.equal(r.steps.length, 2, "one free respin");
  assert.equal(r.steps[1]!.landed[1]![0], "wrapped", "the wrapped rock stays put during the respin");
});

test("scissors cut paper: two torn wilds (the paper and the cell below) held for 2 respins", () => {
  const r = scripted([screen(["scissors paper cloud sun star", "moon cloud star moon cloud", "cloud star moon cloud sun"]), QUIET, QUIET]);
  const t = r.steps[0]!.transforms.find((x) => x.kind === "cut")!;
  assert.deepEqual(t.cells, [[1, 0], [1, 1]]);
  assert.equal(r.steps.length, 3, "two respins: the extra spin");
  for (const k of [1, 2]) assert.deepEqual([r.steps[k]!.landed[1]![0], r.steps[k]!.landed[1]![1]], ["torn", "torn"]);
});

test("a paper on the bottom row is cut upwards", () => {
  const r = scripted([screen(["star moon cloud sun star", "moon cloud star moon cloud", "cloud scissors paper cloud sun"]), QUIET, QUIET]);
  assert.deepEqual(r.steps[0]!.transforms.find((x) => x.kind === "cut")!.cells, [[2, 2], [2, 1]]);
});

test("rock smashes scissors: each pair adds +1 to the spin's win multiplier, capped at x5", () => {
  const one = scripted([screen(["rock scissors cloud sun star", "moon cloud star moon cloud", "cloud star moon cloud sun"])]);
  assert.equal(one.steps[0]!.winMultiplier, 2);
  const two = scripted([screen(["scissors rock scissors sun star", "moon cloud star moon cloud", "cloud star moon cloud sun"])]);
  assert.equal(two.steps[0]!.winMultiplier, 3);
});

test("the multiplier multiplies that spin's line wins", () => {
  // a line of 3 suns on the bottom row with one rock-scissors pair above it
  const plain = scripted([screen(["star moon cloud sun star", "moon cloud star moon cloud", "sun sun sun cloud star"])]);
  const smashed = scripted([screen(["rock scissors cloud sun star", "moon cloud star moon cloud", "sun sun sun cloud star"])]);
  const sunLine = (r: ReturnType<typeof scripted>) => r.steps[0]!.lineWins.find((w) => w.line === 3)!;
  assert.equal(sunLine(plain).multiplier, sunLine(smashed).multiplier);
  assert.equal(smashed.steps[0]!.winMinor, plain.steps[0]!.winMinor * 2);
});

test("all three at once are read from the same landed grid", () => {
  // rock paper scissors rock: wrap (rock-paper), cut (paper-scissors), smash (scissors-rock).
  // No three cells are all next to each other on a grid, so all three need four symbols.
  const r = scripted([screen(["rock paper scissors rock star", "moon cloud star moon cloud", "cloud star moon cloud sun"]), QUIET, QUIET]);
  const kinds = r.steps[0]!.transforms.map((t) => t.kind).sort();
  assert.deepEqual(kinds, ["cut", "smash", "wrap"]);
  assert.equal(r.steps[0]!.winMultiplier, 2);
});

test("held wilds never interact again, and a round never exceeds 8 spins", () => {
  const rng = seededRng(77);
  for (let i = 0; i < 20_000; i++) {
    const r = math.playRound(() => drawStops(rng, config.strips), 1);
    assert.ok(r.steps.length <= 8);
    for (const s of r.steps) for (const t of s.transforms) for (const [reel, row] of t.by) {
      assert.ok(!s.held.some((h) => h.reel === reel && h.row === row), "a held wild caused a transform");
    }
  }
});

test("rounds replay exactly from their recorded stops", () => {
  const rng = seededRng(5);
  for (let i = 0; i < 3000; i++) {
    const live = math.playRound(() => drawStops(rng, config.strips), 5);
    assert.deepEqual(math.playRound((k) => live.steps[k]!.stops, 5), live);
  }
});

test("declared RTP 95.65% is within 4.5 standard errors of a seeded 400k-round simulation", () => {
  const s = simulateRtp(math, 400_000, 20261121);
  const z = (s.rtp - DECLARED_RTP_BPS / 10_000) / s.standardError;
  assert.ok(Math.abs(z) < 4.5, `simulated ${(s.rtp * 100).toFixed(2)}%, z = ${z.toFixed(2)}`);
  assert.ok(s.featureRate > 0.04 && s.featureRate < 0.12, `features in ${(s.featureRate * 100).toFixed(1)}% of rounds`);
});
