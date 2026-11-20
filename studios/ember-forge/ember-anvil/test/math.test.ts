// Ember Anvil's certified math on Kiln: RTP locked and exact, strips generated, simulation agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { payLine } from "@ember-forge/kiln/math";
import { exactLineRtp, simulateRtp } from "@ember-forge/kiln/math/rtp";
import { config, math, STRIPS } from "../src/game.ts";
import { buildStrips } from "../scripts/build-strips.ts";

test("embers substitute, crucibles never do", () => {
  assert.deepEqual(payLine(["ember", "ember", "anvil", "anvil", "ruby"], config), { symbol: "anvil", count: 4, multiplier: 100 });
  assert.equal(payLine(["anvil", "anvil", "crucible", "anvil", "anvil"], config).multiplier, 0);
});

test("strips: 32 stops, one crucible per reel, generated from the counts (never hand-edited)", () => {
  for (const s of STRIPS) { assert.equal(s.length, 32); assert.equal(s.filter((x) => x === "crucible").length, 1); }
  assert.deepEqual(STRIPS, buildStrips());
});

test("declared RTP is locked: exactly 96.39% over all 33,554,432 stop combinations", () => {
  const r = exactLineRtp(config);
  assert.equal(r.cycle, 32 ** 5);
  assert.equal(r.rtpBps, 9639, "math changed: update the manifest, the PAR sheet and re-certify");
});

test("a seeded 300k-round simulation lands within 4.5 standard errors of the exact RTP", () => {
  const s = simulateRtp(math, 300_000, 20261120);
  assert.ok(Math.abs(s.rtp - exactLineRtp(config).rtp) / s.standardError < 4.5);
});
