import type { KeyObject } from "node:crypto";
import { keyRing, newSigningKey, signCanonical, signToken, toJwk, type Envelope, type RoundOutcomeData, type SigningKey } from "@casino-platform/studio-sdk";
import type { KeyDirectory, BuildDirectory } from "../../src/app/ports.ts";

export const PLAYER_A = "8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b";
export const PLAYER_B = "1f2e3d4c-5b6a-4789-8abc-def012345678";

export const studioKey = newSigningKey("ember-forge-test");
export const dealerKey = newSigningKey("dealer-test");

export class FakeKeys implements KeyDirectory, BuildDirectory {
  studios = new Map<string, Map<string, KeyObject>>([["ember-forge", keyRing({ keys: [toJwk(studioKey)] })]]);
  async studioKeys(studio: string) { return this.studios.get(studio) ?? new Map(); }
  async dealerKeys() { return keyRing({ keys: [toJwk(dealerKey)] }); }
  async replayUrl(game: string, version: string) { return `http://studio.test/${game}/${version}/replay.html`; }
}

let n = 0;
export function roundEvent(over: { playerId?: string; operatorCode?: string; winMinor?: number; playedAt?: string; roundId?: string; key?: SigningKey } = {}): Envelope<RoundOutcomeData> {
  n++;
  const roundId = over.roundId ?? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const win = over.winMinor ?? 0;
  const money = (amountMinor: number) => ({ amountMinor, currency: "EUR" });
  const unsigned = {
    roundId, studioCode: "ember-forge", gameCode: "ember-anvil", buildVersion: "1.0.0", mathModelSha256: "a".repeat(64),
    jurisdictionCode: "JUR-A", playerId: over.playerId ?? PLAYER_A, currency: "EUR", stake: money(50), win: money(win), balanceAfter: money(10_000),
    outcome: {
      stops: [1, 2, 3, 4, 5], grid: [["ruby", "jade", "rivet"], ["ruby", "jade", "rivet"], ["ruby", "jade", "rivet"], ["ruby", "jade", "rivet"], ["ruby", "jade", "rivet"]],
      lineWins: win ? [{ line: 1, symbol: "ruby", count: 3, positions: [[0, 0], [1, 0], [2, 0]] as [number, number][], win: money(win) }] : [],
      scatter: { count: 0, win: money(0) },
    },
    playedAt: over.playedAt ?? new Date(Date.now() - (1000 - n) * 1000).toISOString(),
  };
  return {
    eventId: crypto.randomUUID(), eventType: "RoundOutcomeRecorded", schemaVersion: 1, occurredAt: new Date().toISOString(),
    producer: "studio", operatorCode: over.operatorCode ?? "kestrel", partitionKey: roundId,
    data: { ...unsigned, signature: signCanonical(unsigned, over.key ?? studioKey) },
  };
}

export function settledEvent(roundId: string, winMinor: number, playerId = PLAYER_A, stakeMinor = 50): Envelope {
  const money = (amountMinor: number) => ({ amountMinor, currency: "EUR" });
  return {
    eventId: crypto.randomUUID(), eventType: "BetSettled", schemaVersion: 1, occurredAt: new Date().toISOString(), producer: "cashier",
    operatorCode: "kestrel", partitionKey: roundId,
    data: { externalRoundId: roundId, gameCode: "ember-anvil", studioCode: "ember-forge", gameCategory: "slot", jurisdictionCode: "JUR-A", playerId,
      businessDate: "2026-11-20", cashStake: money(stakeMinor), bonusStake: money(0), win: money(winMinor), settledAt: new Date().toISOString() },
  };
}

export function historyToken(playerId = PLAYER_A, over: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signToken({ iss: "dealer", aud: "catwalk", sub: playerId, op: "kestrel", scope: "rounds:read", iat, exp: iat + 600, jti: crypto.randomUUID(), ...over } as any, dealerKey);
}
