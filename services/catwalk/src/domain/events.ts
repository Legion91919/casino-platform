// Validation of the two events Catwalk consumes. Tolerant reader (contracts/README.md rule 1):
// unknown fields are ignored, but every field Catwalk relies on must be present and well-typed.
// Money must be integer minor units; a float is a producer bug and goes to quarantine.
import type { Envelope, RoundOutcomeData } from "@casino-platform/studio-sdk";
import { isUuid } from "@casino-platform/studio-sdk";

export interface Settlement {
  operatorCode: string;
  externalRoundId: string;
  gameCode: string;
  playerId: string;
  currency: string;
  stakeMinor: number;
  winMinor: number;
  settledAt: string;
}

export class InvalidEvent extends Error {}

const isCode = (s: unknown, re = /^[a-z0-9][a-z0-9-]{1,63}$/) => typeof s === "string" && re.test(s);
const isMoney = (m: any, currency?: string) =>
  m && typeof m === "object" && Number.isSafeInteger(m.amountMinor) && m.amountMinor >= 0 && typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency) && (!currency || m.currency === currency);
const isTime = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));
function need(cond: unknown, what: string): asserts cond {
  if (!cond) throw new InvalidEvent(what);
}

export function parseRoundOutcome(e: Envelope): RoundOutcomeData {
  need(e.eventType === "RoundOutcomeRecorded" && e.schemaVersion === 1, "not RoundOutcomeRecorded v1");
  need(e.producer === "studio", "RoundOutcomeRecorded must come from a studio game server");
  need(isCode(e.operatorCode, /^[a-z][a-z0-9-]{1,31}$/), "operatorCode missing");
  const d = e.data as any;
  need(d && typeof d === "object", "data missing");
  need(isUuid(d.roundId) && e.partitionKey === d.roundId, "roundId must be a UUID and the partition key");
  need(isCode(d.studioCode) && isCode(d.gameCode), "studioCode/gameCode malformed");
  need(typeof d.buildVersion === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(d.buildVersion), "buildVersion malformed");
  need(typeof d.mathModelSha256 === "string" && /^[0-9a-f]{64}$/.test(d.mathModelSha256), "mathModelSha256 malformed");
  need(typeof d.jurisdictionCode === "string" && /^JUR-[A-Z0-9]{1,8}$/.test(d.jurisdictionCode), "jurisdictionCode malformed");
  need(isUuid(d.playerId), "playerId must be the pseudonymous UUID");
  need(typeof d.currency === "string" && /^[A-Z]{3}$/.test(d.currency), "currency malformed");
  need(isMoney(d.stake, d.currency) && d.stake.amountMinor > 0, "stake must be positive integer minor units");
  need(isMoney(d.win, d.currency), "win must be integer minor units");
  need(d.balanceAfter && Number.isSafeInteger(d.balanceAfter.amountMinor), "balanceAfter must be integer minor units");
  need(isTime(d.playedAt), "playedAt malformed");
  const o = d.outcome;
  need(o && Array.isArray(o.stops) && o.stops.every(Number.isSafeInteger) && Array.isArray(o.grid) && Array.isArray(o.lineWins) && o.scatter, "outcome needs stops, grid, lineWins and scatter");
  const lineTotal = o.lineWins.reduce((s: number, w: any) => (isMoney(w.win, d.currency) ? s + w.win.amountMinor : Number.NaN), 0);
  need(isMoney(o.scatter.win, d.currency) && lineTotal + o.scatter.win.amountMinor === d.win.amountMinor, "outcome wins do not add up to the round win");
  need(d.signature && d.signature.alg === "Ed25519" && typeof d.signature.keyId === "string" && typeof d.signature.value === "string", "signature missing");
  return d as RoundOutcomeData;
}

export function parseBetSettled(e: Envelope): Settlement {
  need(e.eventType === "BetSettled" && e.schemaVersion === 1 && e.producer === "cashier", "not BetSettled v1 from cashier");
  const d = e.data as any;
  need(d && typeof d.externalRoundId === "string" && d.externalRoundId.length > 0 && d.externalRoundId.length <= 128, "externalRoundId malformed");
  need(isCode(e.operatorCode, /^[a-z][a-z0-9-]{1,31}$/), "operatorCode missing");
  need(isUuid(d.playerId), "playerId malformed");
  need(isMoney(d.cashStake) && isMoney(d.bonusStake, d.cashStake.currency) && isMoney(d.win, d.cashStake.currency), "money malformed");
  need(isTime(d.settledAt), "settledAt malformed");
  return {
    operatorCode: e.operatorCode!, externalRoundId: d.externalRoundId, gameCode: String(d.gameCode), playerId: d.playerId,
    currency: d.cashStake.currency, stakeMinor: d.cashStake.amountMinor + d.bonusStake.amountMinor, winMinor: d.win.amountMinor, settledAt: d.settledAt,
  };
}
