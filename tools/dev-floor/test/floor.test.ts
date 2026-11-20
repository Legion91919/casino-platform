// The doubles keep the platform rules the game server relies on, and the game server's HTTP
// adapters (Cashier wallet, Dealer redeem) work against them: a contract test in both directions.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createFloor, DEMO_PLAYERS, OPERATOR } from "../src/floor.ts";
import { CashierWallet, DealerClient } from "../../../studios/ember-forge/kiln/src/server/platform-http.ts";
import { WalletUnavailable } from "../../../studios/ember-forge/kiln/src/server/ports.ts";

const floor = createFloor({ feedToken: "t", gameOrigins: ["http://game.test"], catwalkOrigin: "http://catwalk.test" });
const port = (s: { address(): unknown }) => (s.address() as AddressInfo).port;
let dealerUrl = "", cashierUrl = "";

before(async () => {
  floor.dealer.publish({ gameCode: "ember-anvil", studioCode: "ember-forge", version: "1.0.0", assetBaseUrl: "http://game.test/", replayEntrypoint: "replay.html", rtpBps: 9639, mathModelSha256: "a".repeat(64) });
  await new Promise<void>((ok) => floor.dealerServer.listen(0, ok));
  await new Promise<void>((ok) => floor.cashierServer.listen(0, ok));
  dealerUrl = `http://127.0.0.1:${port(floor.dealerServer)}`;
  cashierUrl = `http://127.0.0.1:${port(floor.cashierServer)}`;
});
after(() => { floor.dealerServer.close(); floor.cashierServer.close(); });

async function launchAndRedeem(playerIndex = 0) {
  const p = DEMO_PLAYERS[playerIndex]!;
  const l = floor.dealer.launch({ playerId: p.playerId, operatorCode: OPERATOR.code, gameCode: "ember-anvil", jurisdictionCode: "JUR-A", currency: "EUR", returnUrl: "http://lobby.test/" });
  const token = new URLSearchParams(new URL(l.launchUrl).hash.slice(1)).get("token")!;
  const dealer = new DealerClient(dealerUrl, "ember-anvil");
  return { token, dealer, ...(await dealer.redeem(token)), lobby: new URLSearchParams(new URL(l.launchUrl).hash.slice(1)).get("lobby") };
}

test("launch URL carries a single-use token and the lobby origin; redeem returns verified claims", async () => {
  const r = await launchAndRedeem();
  assert.equal(r.claims.playerId, DEMO_PLAYERS[0]!.playerId);
  assert.equal(r.claims.buildVersion, "1.0.0");
  assert.equal(r.lobby, "http://lobby.test");
  await assert.rejects(r.dealer.redeem(r.token), /already used/);
});

test("a killed game cannot be launched", () => {
  floor.dealer.killed.add("ember-anvil");
  assert.throws(() => floor.dealer.launch({ playerId: DEMO_PLAYERS[0]!.playerId, operatorCode: "kestrel", gameCode: "ember-anvil", jurisdictionCode: "JUR-A", currency: "EUR" }), /switched off/);
  floor.dealer.killed.delete("ember-anvil");
});

test("wallet: debit, idempotent replay, conflicting reuse, credit and rollback tombstone through the real adapter", async () => {
  const r = await launchAndRedeem(1);
  const session = { gameSessionToken: r.gameSessionToken, currency: "EUR" } as any;
  const wallet = new CashierWallet(cashierUrl);
  const start = (await wallet.balance(session)).amountMinor;
  const money = (amountMinor: number) => ({ amountMinor, currency: "EUR" });
  const d1 = await wallet.debit(session, { transactionId: "t-1", roundId: "r-1", gameCode: "ember-anvil", amount: money(50) });
  assert.deepEqual(d1, { status: "accepted", balanceMinor: start - 50, replay: false });
  const d2 = await wallet.debit(session, { transactionId: "t-1", roundId: "r-1", gameCode: "ember-anvil", amount: money(50) });
  assert.equal((d2 as any).replay, true);
  assert.deepEqual(await wallet.debit(session, { transactionId: "t-1", roundId: "r-1", gameCode: "ember-anvil", amount: money(500) }), { status: "rejected", code: "IDEMPOTENCY_CONFLICT" });
  await wallet.credit(session, { transactionId: "t-2", roundId: "r-1", gameCode: "ember-anvil", amount: money(120), closeRound: true });
  assert.equal((await wallet.balance(session)).amountMinor, start - 50 + 120);
  await wallet.rollback(session, { transactionId: "t-3", roundId: "r-2", gameCode: "ember-anvil", referenceTransactionId: "t-9" });
  assert.deepEqual(await wallet.debit(session, { transactionId: "t-9", roundId: "r-2", gameCode: "ember-anvil", amount: money(50) }), { status: "rejected", code: "ROLLED_BACK" }, "a stake rolled back before it arrived can never land");
  assert.equal(floor.cashier.events.filter((e) => e.eventType === "BetSettled").length, 1);
});

test("wallet: an outage is reported as WalletUnavailable, and a forged game session is refused", async () => {
  const r = await launchAndRedeem(0);
  const wallet = new CashierWallet(cashierUrl);
  floor.cashier.faults.walletDown = true;
  await assert.rejects(wallet.balance({ gameSessionToken: r.gameSessionToken } as any), WalletUnavailable);
  floor.cashier.faults.walletDown = false;
  const forged = r.gameSessionToken.slice(0, -4) + "AAAA";
  const res = await fetch(`${cashierUrl}/v1/wallet/balance`, { headers: { authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401);
});
