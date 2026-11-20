// Ports: what the spin use case needs from the outside world. Adapters live next to this file
// (Postgres, Cashier over HTTP, Dealer over HTTP); tests swap in in-memory versions.
import type { Money, RoundOutcomeData, Envelope } from "@casino-platform/studio-sdk";

export interface GameSession {
  sessionHash: Buffer;
  launchSessionId: string;
  gameSessionToken: string; // Dealer-signed; the wallet trusts it together with our mTLS certificate
  playerId: string;
  operatorCode: string;
  jurisdictionCode: string;
  currency: string;
  buildVersion: string;
  expiresAt: Date;
}

export type RoundStatus = "opened" | "debited" | "decided" | "settled" | "rejected";

export interface RoundRow {
  roundId: string;
  sessionHash: Buffer;
  playerId: string;
  operatorCode: string;
  jurisdictionCode: string;
  currency: string;
  buildVersion: string;
  mathModelSha256: string;
  lineBetMinor: number;
  stakeMinor: number;
  stakeTxnId: string;
  winTxnId: string;
  status: RoundStatus;
  rejectReason: string | null;
  stops: number[] | null;
  outcome: RoundOutcomeData["outcome"] | null;
  winMinor: number | null;
  balanceAfterMinor: number | null;
  openedAt: Date;
  decidedAt: Date | null;
  settledAt: Date | null;
}

export interface RoundStore {
  saveSession(s: GameSession): Promise<void>;
  findSession(sessionHash: Buffer, now: Date): Promise<GameSession | null>;
  /** Inserts the round if the id is new; returns the stored row either way. */
  openRound(r: Pick<RoundRow, "roundId" | "sessionHash" | "playerId" | "operatorCode" | "jurisdictionCode" | "currency" | "buildVersion" | "mathModelSha256" | "lineBetMinor" | "stakeMinor" | "stakeTxnId" | "winTxnId" | "openedAt">): Promise<{ row: RoundRow; created: boolean }>;
  getRound(roundId: string): Promise<RoundRow | null>;
  markDebited(roundId: string): Promise<void>;
  markRejected(roundId: string, reason: string): Promise<void>;
  /** Freezes the outcome. After this the round can only be paid, never re-drawn. */
  recordDecision(roundId: string, d: { stops: number[]; outcome: RoundOutcomeData["outcome"]; winMinor: number; decidedAt: Date }): Promise<void>;
  /** Settles the round and appends its event to the outbox in one transaction. */
  settle(roundId: string, balanceAfterMinor: number, settledAt: Date, event: Envelope): Promise<void>;
  unsettledRounds(olderThan: Date, limit: number): Promise<RoundRow[]>;
  feed(after: string | null, limit: number): Promise<{ events: Envelope[]; next: string }>;
}

export type WalletResult = { status: "accepted"; balanceMinor: number; replay: boolean } | { status: "rejected"; code: string };

/** Thrown when the wallet did not give an answer (timeout, 5xx, network). The outcome of the call is unknown. */
export class WalletUnavailable extends Error {}

export interface WalletPort {
  balance(session: GameSession): Promise<Money>;
  debit(session: GameSession, req: { transactionId: string; roundId: string; gameCode: string; amount: Money }): Promise<WalletResult>;
  credit(session: GameSession, req: { transactionId: string; roundId: string; gameCode: string; amount: Money; closeRound: boolean }): Promise<WalletResult>;
  rollback(session: GameSession, req: { transactionId: string; roundId: string; gameCode: string; referenceTransactionId: string }): Promise<WalletResult>;
}

export interface LaunchClaims {
  playerId: string;
  operatorCode: string;
  jurisdictionCode: string;
  currency: string;
  gameCode: string;
  buildVersion: string;
  launchSessionId: string;
  expiresAt: Date;
}

export interface DealerPort {
  /** Redeems a single-use launch token; returns the signed game-session token and its verified claims. */
  redeem(launchToken: string): Promise<{ gameSessionToken: string; claims: LaunchClaims }>;
}
