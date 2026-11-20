// The event envelope and feed page every producer serves (contracts/events/envelope.v1.schema.json),
// plus the RoundOutcomeRecorded payload a studio game server publishes for each finished round.
import type { DetachedSignature } from "./signatures.ts";

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Envelope<T = object> {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  operatorCode: string | null;
  partitionKey: string;
  traceparent?: string;
  data: T;
}

export interface FeedPage<T = object> {
  events: Envelope<T>[];
  next: string;
}

export interface LineWin {
  step?: number; // which spin of the round (0 = the paid spin, 1.. = free respins)
  line: number; // 1-based payline number
  symbol: string;
  count: number; // symbols in a row from reel 1
  positions: [number, number][]; // [reel, row] cells that make the win
  win: Money;
}

export interface SlotOutcome {
  stops: number[]; // reel strip index at the top row of each reel: the RNG's only output
  grid: string[][]; // [reel][row] symbol codes, derived from stops by the build's reel strips
  lineWins: LineWin[]; // every line win of the round, already multiplied, each with its step
  scatter: { count: number; win: Money };
  /** Every spin of the round when the game has features (held wilds, respins, multipliers). */
  steps?: {
    step: number;
    stops: number[];
    grid: string[][];
    landed: string[][];
    held: { reel: number; row: number; symbol: string; spinsLeft: number }[];
    transforms: { kind: string; by: [number, number][]; cells: [number, number][]; into?: string; holdSpins?: number }[];
    winMultiplier: number;
    win: Money;
  }[];
}

/** `data` of a RoundOutcomeRecorded v1 event; `signature` covers every other field (canonical JSON). */
export interface RoundOutcomeData {
  roundId: string;
  studioCode: string;
  gameCode: string;
  buildVersion: string;
  mathModelSha256: string;
  jurisdictionCode: string;
  playerId: string;
  currency: string;
  stake: Money;
  win: Money;
  balanceAfter: Money;
  outcome: SlotOutcome;
  playedAt: string;
  signature: DetachedSignature;
}

export function unsignedPart<T extends { signature?: unknown }>(data: T): Omit<T, "signature"> {
  const { signature: _ignored, ...rest } = data;
  return rest;
}
