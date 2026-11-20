import { keyRing, newSigningKey, toJwk } from "@casino-platform/studio-sdk";
import { seededRng, type Rng } from "../../src/math/rng.ts";
import { mathModelSha256 } from "../../src/math/hash.ts";
import type { GameMath } from "../../src/math/types.ts";
import { fixtureMath } from "./fixture-game.ts";
import { MemoryRoundStore } from "../../src/server/memory-store.ts";
import { SpinService } from "../../src/server/spin-service.ts";
import { WalletUnavailable, type DealerPort, type GameSession, type LaunchClaims, type WalletPort, type WalletResult } from "../../src/server/ports.ts";

export class FakeWallet implements WalletPort {
  balances = new Map<string, number>(); // by playerId
  seen = new Map<string, WalletResult>(); // idempotency by transactionId
  calls: { op: string; transactionId: string; amount?: number }[] = [];
  down: Set<"debit" | "credit" | "rollback"> = new Set();
  rolledBack = new Set<string>();

  async balance(s: GameSession) { return { amountMinor: this.balances.get(s.playerId) ?? 0, currency: s.currency }; }
  private once(txn: string, fn: () => WalletResult): WalletResult {
    const prior = this.seen.get(txn);
    if (prior) return prior.status === "accepted" ? { ...prior, replay: true } : prior;
    const r = fn();
    this.seen.set(txn, r);
    return r;
  }
  async debit(s: GameSession, req: { transactionId: string; amount: { amountMinor: number } }) {
    this.calls.push({ op: "debit", transactionId: req.transactionId, amount: req.amount.amountMinor });
    if (this.down.has("debit")) throw new WalletUnavailable("timeout");
    return this.once(req.transactionId, () => {
      if (this.rolledBack.has(req.transactionId)) return { status: "rejected", code: "ROLLED_BACK" };
      const bal = this.balances.get(s.playerId) ?? 0;
      if (bal < req.amount.amountMinor) return { status: "rejected", code: "INSUFFICIENT_FUNDS" };
      this.balances.set(s.playerId, bal - req.amount.amountMinor);
      return { status: "accepted", balanceMinor: bal - req.amount.amountMinor, replay: false };
    });
  }
  async credit(s: GameSession, req: { transactionId: string; amount: { amountMinor: number } }) {
    this.calls.push({ op: "credit", transactionId: req.transactionId, amount: req.amount.amountMinor });
    if (this.down.has("credit")) throw new WalletUnavailable("timeout");
    return this.once(req.transactionId, () => {
      const bal = (this.balances.get(s.playerId) ?? 0) + req.amount.amountMinor;
      this.balances.set(s.playerId, bal);
      return { status: "accepted", balanceMinor: bal, replay: false };
    });
  }
  async rollback(s: GameSession, req: { transactionId: string; referenceTransactionId: string }) {
    this.calls.push({ op: "rollback", transactionId: req.transactionId });
    if (this.down.has("rollback")) throw new WalletUnavailable("timeout");
    this.rolledBack.add(req.referenceTransactionId); // tombstone: the stake can never land later
    const prior = this.seen.get(req.referenceTransactionId);
    if (prior?.status === "accepted") {
      const debit = this.calls.find((c) => c.op === "debit" && c.transactionId === req.referenceTransactionId);
      this.balances.set(s.playerId, (this.balances.get(s.playerId) ?? 0) + (debit?.amount ?? 0));
      this.seen.delete(req.referenceTransactionId);
    }
    return { status: "accepted" as const, balanceMinor: this.balances.get(s.playerId) ?? 0, replay: false };
  }
}

export const PLAYER_A = "8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b";
export const PLAYER_B = "1f2e3d4c-5b6a-4789-8abc-def012345678";

export class FakeDealer implements DealerPort {
  redeemed = new Set<string>();
  build: string;
  constructor(build = "1.0.0") { this.build = build; }
  async redeem(launchToken: string): Promise<{ gameSessionToken: string; claims: LaunchClaims }> {
    if (this.redeemed.has(launchToken)) throw new Error("launch token already used");
    this.redeemed.add(launchToken);
    const playerId = launchToken.startsWith("B") ? PLAYER_B : PLAYER_A;
    return {
      gameSessionToken: `jwt-for-${playerId}`,
      claims: { playerId, operatorCode: "kestrel", jurisdictionCode: "JUR-A", currency: "EUR", gameCode: "ember-anvil", buildVersion: this.build, launchSessionId: `ls-${launchToken.slice(0, 8)}`, expiresAt: new Date(Date.now() + 8 * 3600_000) },
    };
  }
}

export class CountingRng implements Rng {
  draws = 0;
  private inner: Rng;
  constructor(inner: Rng = seededRng(42)) { this.inner = inner; }
  nextInt(n: number) { this.draws++; return this.inner.nextInt(n); }
}

export function harness(opts: { build?: string; math?: GameMath } = {}) {
  const store = new MemoryRoundStore();
  const wallet = new FakeWallet();
  const dealer = new FakeDealer(opts.build);
  const rng = new CountingRng();
  const signingKey = newSigningKey("ember-forge-2026-11");
  let now = new Date("2026-11-20T20:00:00Z");
  const svc = new SpinService({
    store, wallet, dealer, rng, signingKey, clock: () => now, studioCode: "ember-forge", gameCode: "ember-anvil",
    buildVersion: "1.0.0", mathModelSha256: mathModelSha256((opts.math ?? fixtureMath).config), math: opts.math ?? fixtureMath,
  });
  return { svc, store, wallet, dealer, rng, ring: keyRing({ keys: [toJwk(signingKey)] }), advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

export const LAUNCH_A = "A".padEnd(43, "x");
export const LAUNCH_B = "B".padEnd(43, "y");
