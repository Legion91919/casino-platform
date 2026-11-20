import type { KeyObject } from "node:crypto";
import type { Envelope, RoundOutcomeData } from "@casino-platform/studio-sdk";
import type { Settlement } from "../domain/events.ts";

export type IngestAction =
  | { kind: "round"; round: RoundOutcomeData; operatorCode: string; eventId: string }
  | { kind: "settlement"; settlement: Settlement; eventId: string }
  | { kind: "quarantine"; reason: string }
  | { kind: "ignore" };

/** The verified viewer: set only from a Dealer-signed history token. */
export interface Viewer {
  playerId: string;
  operatorCode: string;
}

export interface RoundSummaryRow {
  studioCode: string;
  roundId: string;
  gameCode: string;
  buildVersion: string;
  playedAt: string;
  currency: string;
  stakeMinor: number;
  winMinor: number;
  balanceAfterMinor: number;
  walletCheck: "confirmed" | "mismatch" | "pending";
  walletWinMinor: number | null;
}

export interface RoundDetailRow extends RoundSummaryRow {
  mathModelSha256: string;
  jurisdictionCode: string;
  outcome: RoundOutcomeData["outcome"];
  signatureKeyId: string;
}

export interface ListQuery {
  limit: number;
  before?: { playedAt: string; studioCode: string; roundId: string };
  from?: string;
  to?: string;
  gameCode?: string;
}

export interface HistoryStore {
  checkpoint(feed: string): Promise<string | null>;
  /** One transaction: inbox de-duplication, the action, and the new cursor. */
  process(feed: string, event: Envelope, action: IngestAction, cursor: string): Promise<"applied" | "duplicate">;
  list(viewer: Viewer, q: ListQuery): Promise<RoundSummaryRow[]>;
  get(viewer: Viewer, studioCode: string, roundId: string): Promise<RoundDetailRow | null>;
  summary(viewer: Viewer, from: string, to: string): Promise<{ rounds: number; stakeMinor: number; winMinor: number; biggestWinMinor: number; currency: string | null }>;
}

export interface KeyDirectory {
  /** Public keys a studio registered at Dealer for signing round outcomes. */
  studioKeys(studioCode: string, keyId: string): Promise<Map<string, KeyObject>>;
  /** Dealer's own token-signing keys. */
  dealerKeys(keyId?: string): Promise<Map<string, KeyObject>>;
}

export interface BuildDirectory {
  replayUrl(gameCode: string, buildVersion: string): Promise<string | null>;
}
