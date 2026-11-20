// Contract double of Cashier's seamless wallet (services/cashier/api/openapi.yaml), in memory.
// Keeps the rules the game server depends on: game-session tokens verified against Dealer's keys,
// idempotency on transactionId (same body -> stored answer, different body -> 409), rollback
// tombstones, integer money, and a BetSettled event feed for consumers such as Catwalk.
import { randomUUID, type KeyObject } from "node:crypto";
import { canonicalJson, verifyToken, type Envelope, type TokenClaims } from "@casino-platform/studio-sdk";
import { HttpError } from "@casino-platform/studio-sdk/http";

interface Stored { status: number; body: any; fingerprint: string }
interface RoundAcc { stake: number; claims: TokenClaims; gameCode: string }

export class CashierDouble {
  readonly cash = new Map<string, number>(); // `${operator}:${player}` -> minor units
  private txns = new Map<string, Stored>();
  private tombstones = new Set<string>();
  private debits = new Map<string, { key: string; amount: number; roundId: string }>();
  private rounds = new Map<string, RoundAcc>();
  readonly events: Envelope[] = [];
  faults = { walletDown: false, creditDown: false, skewNextSettlementMinor: 0 };
  private keys: () => Map<string, KeyObject>;
  constructor(keys: () => Map<string, KeyObject>) { this.keys = keys; }

  auth(token: string): TokenClaims {
    try {
      return verifyToken(token, this.keys(), { issuer: "dealer", audience: /^game:[a-z0-9-]{2,64}$/ });
    } catch {
      throw new HttpError(401, "UNAUTHENTICATED", "game-session token missing or invalid");
    }
  }

  private acct(c: TokenClaims) { return `${c.op}:${c.sub}`; }
  balanceBody(c: TokenClaims) {
    return { cash: { amountMinor: this.cash.get(this.acct(c)) ?? 0, currency: String(c.cur) }, bonus: { amountMinor: 0, currency: String(c.cur) } };
  }

  private idem(txn: string, body: unknown, run: () => { status: number; body: any }): { status: number; body: any; replay: boolean } {
    if (this.faults.walletDown) throw new HttpError(503, "WALLET_DOWN", "dev fault: wallet unavailable");
    const fingerprint = canonicalJson(body);
    const prior = this.txns.get(txn);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "transactionId reused with a different body");
      return { ...prior, replay: true };
    }
    const r = run();
    this.txns.set(txn, { ...r, fingerprint });
    return { ...r, replay: false };
  }

  private validMoney(m: any, c: TokenClaims) {
    if (!m || !Number.isSafeInteger(m.amountMinor) || m.amountMinor < 0 || m.currency !== c.cur) throw new HttpError(400, "BAD_MONEY", "amount must be integer minor units in the session currency");
  }

  debit(c: TokenClaims, req: any) {
    this.validMoney(req.amount, c);
    return this.idem(req.transactionId, req, () => {
      if (this.tombstones.has(req.transactionId)) return { status: 422, body: { code: "ROLLED_BACK" } };
      const key = this.acct(c);
      const bal = this.cash.get(key) ?? 0;
      if (bal < req.amount.amountMinor) return { status: 422, body: { type: "about:blank", title: "Insufficient funds", status: 422, code: "INSUFFICIENT_FUNDS" } };
      this.cash.set(key, bal - req.amount.amountMinor);
      this.debits.set(req.transactionId, { key, amount: req.amount.amountMinor, roundId: req.roundId });
      const acc = this.rounds.get(req.roundId) ?? { stake: 0, claims: c, gameCode: req.gameCode };
      acc.stake += req.amount.amountMinor;
      this.rounds.set(req.roundId, acc);
      this.events.push(this.envelope("BetPlaced", c, req.roundId, { externalRoundId: req.roundId, gameCode: req.gameCode, playerId: c.sub, stake: req.amount }));
      return { status: 200, body: { transactionId: req.transactionId, status: "accepted", balance: this.balanceBody(c) } };
    });
  }

  credit(c: TokenClaims, req: any) {
    this.validMoney(req.amount, c);
    return this.idem(req.transactionId, req, () => {
      const key = this.acct(c);
      this.cash.set(key, (this.cash.get(key) ?? 0) + req.amount.amountMinor);
      const acc = this.rounds.get(req.roundId);
      if (req.closeRound && acc) {
        const skew = this.faults.skewNextSettlementMinor;
        this.faults.skewNextSettlementMinor = 0;
        const money = (amountMinor: number) => ({ amountMinor, currency: String(c.cur) });
        this.events.push(this.envelope("BetSettled", c, req.roundId, {
          externalRoundId: req.roundId, gameCode: req.gameCode, studioCode: "ember-forge", gameCategory: "slot", // every floor game is an Ember Forge slot
          jurisdictionCode: String(c.jur), playerId: c.sub, businessDate: new Date().toISOString().slice(0, 10),
          cashStake: money(acc.stake), bonusStake: money(0), win: money(req.amount.amountMinor + skew), settledAt: new Date().toISOString(),
        }));
        this.rounds.delete(req.roundId);
      }
      return { status: 200, body: { transactionId: req.transactionId, status: "accepted", balance: this.balanceBody(c) } };
    });
  }

  rollback(c: TokenClaims, req: any) {
    return this.idem(req.transactionId, req, () => {
      this.tombstones.add(req.referenceTransactionId);
      const d = this.debits.get(req.referenceTransactionId);
      if (d) {
        this.cash.set(d.key, (this.cash.get(d.key) ?? 0) + d.amount);
        this.debits.delete(req.referenceTransactionId);
        this.rounds.delete(d.roundId);
        return { status: 200, body: { transactionId: req.transactionId, status: "accepted", balance: this.balanceBody(c) } };
      }
      return { status: 200, body: { transactionId: req.transactionId, status: "tombstoned", balance: this.balanceBody(c) } };
    });
  }

  private envelope(eventType: string, c: TokenClaims, roundId: string, data: object): Envelope {
    return { eventId: randomUUID(), eventType, schemaVersion: 1, occurredAt: new Date().toISOString(), producer: "cashier", operatorCode: String(c.op), partitionKey: roundId, data };
  }

  feed(after: string | null, limit: number) {
    const start = after && /^\d+$/.test(after) ? Number(after) : 0;
    const events = this.events.slice(start, start + Math.min(limit, 500));
    return { events, next: String(start + events.length) };
  }
}
