// Kiln's math engine: paylines, wilds, scatters, the round loop with held wilds, exact RTP vs brute force.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStrips, createLineGame, gridFor, payLine, seededRng, drawStops, toOutcome } from "../src/math/index.ts";
import { bruteForceRtp, exactLineRtp, simulateRtp } from "../src/math/rtp.ts";
import { mathModelSha256 } from "../src/math/hash.ts";
import { featureMath, fixtureConfig as c, fixtureMath } from "./support/fixture-game.ts";

test("wilds substitute; a leading wild run pays alone when it beats the symbol it completes", () => {
  assert.deepEqual(payLine(["w", "w", "a", "a", "x"], c), { symbol: "a", count: 4, multiplier: 40 });
  assert.deepEqual(payLine(["w", "w", "w", "x", "c"], c), { symbol: "w", count: 3, multiplier: 20 });
  assert.deepEqual(payLine(["w", "w", "w", "w", "w"], c), { symbol: "w", count: 5, multiplier: 500 });
});

test("extra wilds act as wilds; scatters break lines and are never substituted", () => {
  assert.deepEqual(payLine(["held", "a", "a", "c", "c"], c), { symbol: "a", count: 3, multiplier: 10 });
  assert.equal(payLine(["a", "a", "s", "a", "a"], c).multiplier, 0);
});

test("stops off a strip are refused, not wrapped", () => {
  assert.throws(() => gridFor([0, 0, 0, 0, 20], c), /off reel 5/);
});

test("exact RTP equals brute force over a full cycle of small strips (method proof)", () => {
  const small = { ...c, strips: buildStrips(Array(5).fill({ w: 1, a: 1, b: 1, s: 1, x: 2 }), 6, 1) };
  const exact = exactLineRtp(small);
  const brute = bruteForceRtp(createLineGame(small));
  assert.equal(brute.totalPerCycle, small.lines.length * (exact.linePayPerCycle + exact.scatterPayPerCycle));
});

test("without features, a round is exactly one step", () => {
  const r = fixtureMath.playRound(() => [0, 1, 2, 3, 4], 1);
  assert.equal(r.steps.length, 1);
});

test("held wilds stay for their spins, then the round ends; respins are capped", () => {
  const rng = seededRng(9);
  let sawRespin = false;
  for (let i = 0; i < 2000; i++) {
    const r = featureMath.playRound(() => drawStops(rng, featureMath.config.strips), 1);
    assert.ok(r.steps.length <= 4, "maxSteps caps the round");
    for (let k = 1; k < r.steps.length; k++) {
      sawRespin = true;
      for (const h of r.steps[k]!.held) assert.equal(r.steps[k]!.landed[h.reel]![h.row], "held", "a held cell keeps its wild when the reels respin");
    }
  }
  assert.ok(sawRespin);
});

test("a round replays exactly from its recorded stops alone", () => {
  const rng = seededRng(4);
  for (let i = 0; i < 500; i++) {
    const live = featureMath.playRound(() => drawStops(rng, featureMath.config.strips), 2);
    const replay = featureMath.playRound((k) => live.steps[k]!.stops, 2);
    assert.deepEqual(replay, live);
  }
});

test("the outcome adds up: line wins across steps plus scatter equal the round win", () => {
  const rng = seededRng(5);
  for (let i = 0; i < 500; i++) {
    const r = featureMath.playRound(() => drawStops(rng, featureMath.config.strips), 5);
    const o = toOutcome(r, 5, "EUR", 10);
    assert.equal(o.lineWins.reduce((t, w) => t + w.win.amountMinor, 0) + o.scatter.win.amountMinor, r.totalWinMinor);
  }
});

test("simulation agrees with exact RTP within 4.5 standard errors", () => {
  const s = simulateRtp(fixtureMath, 200_000, 2);
  assert.ok(Math.abs(s.rtp - exactLineRtp(c).rtp) / s.standardError < 4.5);
});

test("the seeded RNG is uniform (chi-square, 19 df) and the math hash tracks the model", () => {
  const rng = seededRng(7), bins = new Array(20).fill(0), n = 200_000;
  for (let i = 0; i < n; i++) bins[rng.nextInt(20)]++;
  const chi = bins.reduce((t, o) => t + (o - n / 20) ** 2 / (n / 20), 0);
  assert.ok(chi < 43.8, `chi-square ${chi}`); // p = 0.001
  assert.notEqual(mathModelSha256(c), mathModelSha256({ ...c, paytable: { ...c.paytable, a: [10, 40, 101] } }));
  assert.notEqual(mathModelSha256(c, "rules-1"), mathModelSha256(c, "rules-2"));
});
