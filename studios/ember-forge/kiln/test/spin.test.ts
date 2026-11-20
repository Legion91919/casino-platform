import { test } from "node:test";
import assert from "node:assert/strict";
import { unsignedPart, verifyCanonical, type RoundOutcomeData } from "@casino-platform/studio-sdk";
import { fixtureMath, featureMath } from "./support/fixture-game.ts";
import { SpinError } from "../src/server/spin-service.ts";
import { harness, LAUNCH_A, LAUNCH_B, PLAYER_A, PLAYER_B } from "./support/fakes.ts";

const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rejects = (p: Promise<unknown>, code: string, status: number) =>
  assert.rejects(p, (e: unknown) => e instanceof SpinError && e.code === code && e.httpStatus === status);

async function launched(h = harness(), balance = 10_000) {
  h.wallet.balances.set(PLAYER_A, balance);
  const { sessionToken } = await h.svc.openSession(LAUNCH_A);
  return { h, token: sessionToken };
}

test("a spin debits the stake, pays the win of the drawn stops and reports the new balance", async () => {
  const { h, token } = await launched();
  const r = await h.svc.spin(token, { roundId: rid(1), lineBetMinor: 5 });
  const again = fixtureMath.playRound(() => r.outcome.stops, 5);
  assert.equal(r.stake.amountMinor, 50);
  assert.equal(r.win.amountMinor, again.totalWinMinor);
  assert.deepEqual(r.outcome.grid, again.steps[0]!.final);
  assert.equal(r.balanceAfter.amountMinor, 10_000 - 50 + r.win.amountMinor);
  assert.equal(h.wallet.balances.get(PLAYER_A), r.balanceAfter.amountMinor);
});

test("each settled round publishes one signed RoundOutcomeRecorded event", async () => {
  const { h, token } = await launched();
  const r = await h.svc.spin(token, { roundId: rid(2), lineBetMinor: 10 });
  assert.equal(h.store.outbox.length, 1);
  const ev = h.store.outbox[0]!;
  const data = ev.data as unknown as RoundOutcomeData;
  assert.equal(ev.eventType, "RoundOutcomeRecorded");
  assert.equal(ev.partitionKey, rid(2));
  assert.equal(data.playerId, PLAYER_A);
  assert.equal(data.win.amountMinor, r.win.amountMinor);
  assert.ok(verifyCanonical(unsignedPart(data), data.signature, h.ring), "signature verifies");
  assert.ok(!verifyCanonical({ ...unsignedPart(data), win: { amountMinor: 999_999, currency: "EUR" } }, data.signature, h.ring), "a doctored win does not");
});

test("retrying the same roundId returns the stored result and never debits twice", async () => {
  const { h, token } = await launched();
  const first = await h.svc.spin(token, { roundId: rid(3), lineBetMinor: 2 });
  const draws = h.rng.draws;
  const again = await h.svc.spin(token, { roundId: rid(3), lineBetMinor: 2 });
  assert.deepEqual({ ...again, replayed: false }, { ...first, replayed: false });
  assert.equal(again.replayed, true);
  assert.equal(h.rng.draws, draws, "no new draw");
  assert.equal(h.wallet.calls.filter((c) => c.op === "debit").length, 1);
  assert.equal(h.store.outbox.length, 1);
});

test("the same roundId with a different bet is a conflict", async () => {
  const { h, token } = await launched();
  await h.svc.spin(token, { roundId: rid(4), lineBetMinor: 2 });
  await rejects(h.svc.spin(token, { roundId: rid(4), lineBetMinor: 50 }), "ROUND_ID_CONFLICT", 409);
});

test("another player cannot read or continue someone else's round by guessing its id", async () => {
  const { h, token } = await launched();
  await h.svc.spin(token, { roundId: rid(5), lineBetMinor: 2 });
  h.wallet.balances.set(PLAYER_B, 10_000);
  const b = await h.svc.openSession(LAUNCH_B);
  await rejects(h.svc.spin(b.sessionToken, { roundId: rid(5), lineBetMinor: 2 }), "ROUND_ID_CONFLICT", 409);
  assert.equal(h.wallet.balances.get(PLAYER_B), 10_000);
});

test("a refused stake rejects the round before any reels are drawn, and stays refused on retry", async () => {
  const { h, token } = await launched(undefined, 30);
  await rejects(h.svc.spin(token, { roundId: rid(6), lineBetMinor: 5 }), "INSUFFICIENT_FUNDS", 422);
  assert.equal(h.rng.draws, 0);
  assert.equal((await h.store.getRound(rid(6)))!.status, "rejected");
  await rejects(h.svc.spin(token, { roundId: rid(6), lineBetMinor: 5 }), "INSUFFICIENT_FUNDS", 422);
});

test("wallet down on the stake: the stake is rolled back (tombstoned) and the round rejected", async () => {
  const { h, token } = await launched();
  h.wallet.down.add("debit");
  await rejects(h.svc.spin(token, { roundId: rid(7), lineBetMinor: 5 }), "WALLET_UNAVAILABLE", 503);
  assert.ok(h.wallet.calls.some((c) => c.op === "rollback"));
  assert.equal((await h.store.getRound(rid(7)))!.status, "rejected");
  assert.equal(h.wallet.balances.get(PLAYER_A), 10_000);
});

test("wallet down on the win: the outcome is frozen and a retry pays exactly that outcome", async () => {
  const { h, token } = await launched();
  h.wallet.down.add("credit");
  await rejects(h.svc.spin(token, { roundId: rid(8), lineBetMinor: 20 }), "ROUND_PENDING", 503);
  const frozen = (await h.store.getRound(rid(8)))!;
  assert.equal(frozen.status, "decided");
  const draws = h.rng.draws;
  h.wallet.down.clear();
  const paid = await h.svc.spin(token, { roundId: rid(8), lineBetMinor: 20 });
  assert.deepEqual(paid.outcome.stops, frozen.stops);
  assert.equal(paid.win.amountMinor, frozen.winMinor);
  assert.equal(h.rng.draws, draws, "the reels were not re-drawn");
});

test("the background resumer pays decided rounds and rolls back abandoned ones", async () => {
  const { h, token } = await launched();
  h.wallet.down.add("credit");
  await rejects(h.svc.spin(token, { roundId: rid(9), lineBetMinor: 1 }), "ROUND_PENDING", 503);
  // A round that crashed after opening, before the debit answer came back:
  const s = await h.svc.session(token);
  await h.store.openRound({ ...(await h.store.getRound(rid(9)))!, roundId: rid(10), sessionHash: s.sessionHash, stakeTxnId: "0190f000-0000-7000-8000-000000000010", winTxnId: "0190f000-0000-7000-8000-000000000011", openedAt: new Date("2026-11-20T20:00:00Z") });
  h.wallet.down.clear();
  h.advance(60_000);
  const r = await h.svc.resumeUnsettled();
  assert.equal(r.resumed, 1);
  assert.equal((await h.store.getRound(rid(9)))!.status, "settled");
  assert.equal((await h.store.getRound(rid(10)))!.status, "rejected");
  assert.equal(h.store.outbox.length, 1);
});

test("bad input is refused: unknown bet, non-UUID round id, expired session", async () => {
  const { h, token } = await launched();
  await rejects(h.svc.spin(token, { roundId: rid(11), lineBetMinor: 3 }), "BAD_BET", 400);
  await rejects(h.svc.spin(token, { roundId: "round-1", lineBetMinor: 5 }), "BAD_ROUND_ID", 400);
  await rejects(h.svc.spin("not-a-session", { roundId: rid(12), lineBetMinor: 5 }), "SESSION_EXPIRED", 401);
  h.advance(5 * 3600_000);
  await rejects(h.svc.spin(token, { roundId: rid(13), lineBetMinor: 5 }), "SESSION_EXPIRED", 401);
});

test("a launch for a different build is refused: the server only plays the build Dealer released", async () => {
  const h = harness({ build: "1.1.0" });
  await rejects(h.svc.openSession(LAUNCH_A), "WRONG_BUILD", 403);
});

test("a launch token is single-use", async () => {
  const { h } = await launched();
  await assert.rejects(h.svc.openSession(LAUNCH_A), /already used/);
});

test("player B's balance and rounds are untouched by player A's play", async () => {
  const { h, token } = await launched();
  h.wallet.balances.set(PLAYER_B, 777);
  for (let i = 20; i < 30; i++) await h.svc.spin(token, { roundId: rid(i), lineBetMinor: 1 });
  assert.equal(h.wallet.balances.get(PLAYER_B), 777);
});

test("a feature round (held wilds, free respins) is drawn whole, frozen, paid once and replays from its stops", async () => {
  const h = harness({ math: featureMath });
  h.wallet.balances.set(PLAYER_A, 100_000);
  const { sessionToken } = await h.svc.openSession(LAUNCH_A);
  let multi = null;
  for (let i = 100; i < 400 && !multi; i++) {
    const r = await h.svc.spin(sessionToken, { roundId: rid(i), lineBetMinor: 1 });
    if ((r.outcome.steps?.length ?? 0) > 1) multi = r;
  }
  assert.ok(multi, "a respin round occurred");
  const stops = multi.outcome.steps!.map((s) => s.stops);
  const replay = featureMath.playRound((k) => stops[k]!, 1);
  assert.equal(replay.totalWinMinor, multi.win.amountMinor);
  assert.equal(h.wallet.calls.filter((c) => c.op === "debit" && c.amount === 10).length, h.wallet.calls.filter((c) => c.op === "credit").length, "one stake and one credit per round, however many respins");
  const lineSum = multi.outcome.lineWins.reduce((t, w) => t + w.win.amountMinor, 0) + multi.outcome.scatter.win.amountMinor;
  assert.equal(lineSum, multi.win.amountMinor, "line wins across steps add up to the round win");
});
