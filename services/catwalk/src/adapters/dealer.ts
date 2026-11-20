// Dealer lookups: studio round-signing keys, Dealer's token keys, and where each build's replay
// renderer lives. Cached; an unknown key id triggers at most one refetch per 10 s per studio, so
// a flood of events with made-up key ids cannot be turned into a flood of calls to Dealer.
import type { KeyObject } from "node:crypto";
import { keyRing } from "@casino-platform/studio-sdk";
import type { BuildDirectory, KeyDirectory } from "../app/ports.ts";

interface Cached { ring: Map<string, KeyObject>; at: number }

export class DealerDirectory implements KeyDirectory, BuildDirectory {
  private readonly baseUrl: string;
  private readonly studios = new Map<string, Cached>();
  private dealer: Cached | null = null;
  private readonly builds = new Map<string, string | null>();
  private readonly now: () => number;
  constructor(baseUrl: string, now: () => number = Date.now) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.now = now;
  }

  private async fetchJson(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(2_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Dealer ${path} answered ${res.status}`);
    return res.json();
  }

  private stale(c: Cached | null | undefined, keyId?: string) {
    if (!c) return true;
    const age = this.now() - c.at;
    if (age > 300_000) return true;
    return keyId !== undefined && !c.ring.has(keyId) && age > 10_000;
  }

  async studioKeys(studioCode: string, keyId: string) {
    const c = this.studios.get(studioCode);
    if (!this.stale(c, keyId)) return c!.ring;
    const jwks = (await this.fetchJson(`/v1/studios/${encodeURIComponent(studioCode)}/signing-keys`)) ?? { keys: [] };
    const fresh = { ring: keyRing(jwks), at: this.now() };
    this.studios.set(studioCode, fresh);
    return fresh.ring;
  }

  async dealerKeys(keyId?: string) {
    if (!this.stale(this.dealer, keyId)) return this.dealer!.ring;
    this.dealer = { ring: keyRing((await this.fetchJson("/.well-known/jwks.json")) ?? { keys: [] }), at: this.now() };
    return this.dealer.ring;
  }

  async replayUrl(gameCode: string, buildVersion: string) {
    const k = `${gameCode}@${buildVersion}`;
    if (this.builds.has(k)) return this.builds.get(k)!;
    const b = await this.fetchJson(`/v1/games/${encodeURIComponent(gameCode)}/builds/${encodeURIComponent(buildVersion)}`);
    const url = b?.replayEntrypoint ? new URL(b.replayEntrypoint, b.assetBaseUrl).toString() : null;
    this.builds.set(k, url);
    return url;
  }
}
