// In-memory RoundStore for fast unit tests. Mirrors the Postgres adapter's conditional updates.
import type { Envelope } from "@casino-platform/studio-sdk";
import type { GameSession, RoundRow, RoundStore } from "./ports.ts";

export class MemoryRoundStore implements RoundStore {
  sessions = new Map<string, GameSession>();
  rounds = new Map<string, RoundRow>();
  outbox: Envelope[] = [];

  async saveSession(s: GameSession) { this.sessions.set(s.sessionHash.toString("hex"), s); }
  async findSession(h: Buffer, now: Date) {
    const s = this.sessions.get(h.toString("hex"));
    return s && s.expiresAt > now ? s : null;
  }
  async openRound(r: Parameters<RoundStore["openRound"]>[0]) {
    const existing = this.rounds.get(r.roundId);
    if (existing) return { row: { ...existing }, created: false };
    const row: RoundRow = { ...r, status: "opened", rejectReason: null, stops: null, outcome: null, winMinor: null, balanceAfterMinor: null, decidedAt: null, settledAt: null };
    this.rounds.set(r.roundId, row);
    return { row: { ...row }, created: true };
  }
  async getRound(id: string) { const r = this.rounds.get(id); return r ? { ...r } : null; }
  private update(id: string, from: RoundRow["status"][], patch: Partial<RoundRow>) {
    const r = this.rounds.get(id);
    if (r && from.includes(r.status)) Object.assign(r, patch);
  }
  async markDebited(id: string) { this.update(id, ["opened"], { status: "debited" }); }
  async markRejected(id: string, reason: string) { this.update(id, ["opened", "debited"], { status: "rejected", rejectReason: reason }); }
  async recordDecision(id: string, d: Parameters<RoundStore["recordDecision"]>[1]) { this.update(id, ["debited"], { status: "decided", ...d }); }
  async settle(id: string, balanceAfterMinor: number, settledAt: Date, event: Envelope) {
    const r = this.rounds.get(id);
    if (r?.status !== "decided") return;
    Object.assign(r, { status: "settled", balanceAfterMinor, settledAt });
    this.outbox.push(event);
  }
  async unsettledRounds(olderThan: Date, limit: number) {
    return [...this.rounds.values()].filter((r) => ["opened", "debited", "decided"].includes(r.status) && r.openedAt < olderThan).slice(0, limit);
  }
  async feed(after: string | null, limit: number) {
    const start = after ? Number(after) : 0;
    const events = this.outbox.slice(start, start + limit);
    return { events, next: String(start + events.length) };
  }
}
