import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newSigningKey } from "@casino-platform/studio-sdk";
import { decide } from "../src/app/ingest.ts";
import { parseRoundOutcome } from "../src/domain/events.ts";
import { viewerFromToken } from "../src/app/history.ts";
import { FakeKeys, historyToken, PLAYER_A, roundEvent, settledEvent } from "./support/events.ts";

const keys = new FakeKeys();

test("a correctly signed round is accepted into history", async () => {
  const a = await decide(roundEvent({ winMinor: 120 }), keys);
  assert.equal(a.kind, "round");
});

test("a round whose win was changed after signing is quarantined, never shown", async () => {
  const e = roundEvent({ winMinor: 0 });
  (e.data as any).win.amountMinor = 0;
  (e.data as any).balanceAfter.amountMinor = 99_999; // doctored after signing
  const a = await decide(e, keys);
  assert.equal(a.kind, "quarantine");
  assert.match((a as any).reason, /signature does not verify/);
});

test("a round signed by a key the studio never registered is quarantined", async () => {
  const a = await decide(roundEvent({ key: newSigningKey("ember-forge-test") }), keys); // same key id, different key
  assert.equal(a.kind, "quarantine");
});

test("float money, wins that don't add up and the wrong producer are quarantined", async () => {
  const float = roundEvent({ winMinor: 120 });
  (float.data as any).stake.amountMinor = 0.5;
  assert.match(((await decide(float, keys)) as any).reason, /stake/);

  const sums = roundEvent({ winMinor: 120 });
  (sums.data as any).win.amountMinor = 121;
  assert.match(((await decide(sums, keys)) as any).reason, /add up/);

  const producer = { ...roundEvent(), producer: "cashier" };
  assert.match(((await decide(producer, keys)) as any).reason, /studio/);
});

test("BetSettled becomes a wallet settlement; other cashier events are ignored", async () => {
  assert.equal((await decide(settledEvent("r-1", 0), keys)).kind, "settlement");
  assert.equal((await decide({ ...settledEvent("r-1", 0), eventType: "BetPlaced" }, keys)).kind, "ignore");
});

test("consumer contract test: the contract's valid example passes Catwalk's reader", () => {
  const example = JSON.parse(readFileSync(new URL("../../../contracts/events/examples/round-outcome-recorded.valid.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => parseRoundOutcome(example));
});

test("history tokens: only Dealer-signed, catwalk-audience, rounds:read tokens identify a player", async () => {
  assert.deepEqual(await viewerFromToken(historyToken(), keys), { playerId: PLAYER_A, operatorCode: "kestrel" });
  await assert.rejects(viewerFromToken(historyToken(PLAYER_A, { aud: "game:ember-anvil" }), keys), /audience/);
  await assert.rejects(viewerFromToken(historyToken(PLAYER_A, { scope: "wallet:write" }), keys), /round history/);
  await assert.rejects(viewerFromToken(historyToken(PLAYER_A, { exp: 1 }), keys), /expired/);
  await assert.rejects(viewerFromToken("", keys), /lobby/);
});
