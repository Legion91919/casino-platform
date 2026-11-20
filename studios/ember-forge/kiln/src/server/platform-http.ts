// Adapters for the two platform services the game server calls: Cashier (seamless wallet) and
// Dealer (launch redemption, token keys, studio key registration). In production both calls also
// carry the studio's mTLS client certificate; locally they go to the dev floor's contract doubles.
import { keyRing, verifyToken, type Ed25519Jwk } from "@casino-platform/studio-sdk";
import type { KeyObject } from "node:crypto";
import { WalletUnavailable, type DealerPort, type GameSession, type LaunchClaims, type WalletPort, type WalletResult } from "./ports.ts";

const TIMEOUT_MS = 2_000;

export class CashierWallet implements WalletPort {
  private readonly baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl = baseUrl.replace(/\/$/, ""); }

  private async call(session: GameSession, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any; replay: boolean }> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${session.gameSessionToken}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new WalletUnavailable(`cashier unreachable: ${(e as Error).message}`);
    }
    if (res.status >= 500) throw new WalletUnavailable(`cashier answered ${res.status}`);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, replay: res.headers.get("idempotent-replay") === "true" };
  }

  private result(r: { status: number; json: any; replay: boolean }): WalletResult {
    if (r.status === 200 && r.json?.status === "accepted") {
      const b = r.json.balance;
      return { status: "accepted", balanceMinor: Number(b.cash.amountMinor) + Number(b.bonus.amountMinor), replay: r.replay };
    }
    if (r.status === 200 || r.status === 422 || r.status === 409) return { status: "rejected", code: String(r.json?.code ?? "REJECTED") };
    throw new WalletUnavailable(`unexpected cashier answer ${r.status}`);
  }

  async balance(s: GameSession) {
    const r = await this.call(s, "GET", "/v1/wallet/balance");
    if (r.status !== 200) throw new WalletUnavailable(`balance failed: ${r.status}`);
    return { amountMinor: Number(r.json.cash.amountMinor) + Number(r.json.bonus.amountMinor), currency: r.json.cash.currency };
  }
  async debit(s: GameSession, req: Parameters<WalletPort["debit"]>[1]) { return this.result(await this.call(s, "POST", "/v1/wallet/debit", req)); }
  async credit(s: GameSession, req: Parameters<WalletPort["credit"]>[1]) { return this.result(await this.call(s, "POST", "/v1/wallet/credit", req)); }
  async rollback(s: GameSession, req: Parameters<WalletPort["rollback"]>[1]) { return this.result(await this.call(s, "POST", "/v1/wallet/rollback", req)); }
}

export class DealerClient implements DealerPort {
  private readonly baseUrl: string;
  private readonly gameCode: string;
  private keys: Map<string, KeyObject> = new Map();
  private keysAt = 0;
  constructor(baseUrl: string, gameCode: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.gameCode = gameCode;
  }

  private async refreshKeys(force = false) {
    if (!force && Date.now() - this.keysAt < 300_000 && this.keys.size > 0) return;
    const res = await fetch(`${this.baseUrl}/.well-known/jwks.json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Dealer JWKS unavailable (${res.status})`);
    this.keys = keyRing(await res.json());
    this.keysAt = Date.now();
  }

  async redeem(launchToken: string): Promise<{ gameSessionToken: string; claims: LaunchClaims }> {
    const res = await fetch(`${this.baseUrl}/v1/launch-sessions/redeem`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchToken }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 410) throw Object.assign(new Error("launch link already used or expired"), { httpStatus: 410 });
    if (!res.ok) throw new Error(`Dealer redeem failed (${res.status})`);
    const { gameSessionToken } = (await res.json()) as { gameSessionToken: string };
    await this.refreshKeys();
    const verify = () => verifyToken(gameSessionToken, this.keys, { issuer: "dealer", audience: `game:${this.gameCode}` });
    let c;
    try { c = verify(); } catch { await this.refreshKeys(true); c = verify(); } // key rotation: refetch once
    return {
      gameSessionToken,
      claims: {
        playerId: c.sub, operatorCode: String(c.op), jurisdictionCode: String(c.jur), currency: String(c.cur),
        gameCode: String(c.game), buildVersion: String(c.build), launchSessionId: String(c.sid), expiresAt: new Date(c.exp * 1000),
      },
    };
  }

  /** Registers the studio's round-signing public key so Catwalk can verify our round outcomes. */
  async registerSigningKey(studioCode: string, jwk: Ed25519Jwk) {
    const res = await fetch(`${this.baseUrl}/v1/studios/${studioCode}/signing-keys/${encodeURIComponent(jwk.kid)}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(jwk), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`key registration failed (${res.status})`);
  }
}
