// Postgres adapter for RoundStore. Every state change is a conditional UPDATE on the expected
// status, so two concurrent requests for one round cannot both draw or both settle; the
// database trigger (db/migrations/V001__init.sql) is the second line of defence.
import pg from "pg";
import type { Envelope } from "@casino-platform/studio-sdk";
import type { GameSession, RoundRow, RoundStore } from "./ports.ts";

const int = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toRow(r: Record<string, any>): RoundRow {
  return {
    roundId: r.round_id, sessionHash: r.session_hash, playerId: r.player_id, operatorCode: r.operator_code,
    jurisdictionCode: r.jurisdiction_code, currency: r.currency, buildVersion: r.build_version,
    mathModelSha256: r.math_model_sha256, lineBetMinor: r.line_bet_minor, stakeMinor: Number(r.stake_minor),
    stakeTxnId: r.stake_txn_id, winTxnId: r.win_txn_id, status: r.status, rejectReason: r.reject_reason,
    stops: r.stops, outcome: r.outcome, winMinor: int(r.win_minor), balanceAfterMinor: int(r.balance_after_minor),
    openedAt: r.opened_at, decidedAt: r.decided_at, settledAt: r.settled_at,
  };
}

export class PgRoundStore implements RoundStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async saveSession(s: GameSession) {
    await this.pool.query(
      `INSERT INTO kiln.game_session (session_hash, launch_session_id, game_session_token, player_id, operator_code, jurisdiction_code, currency, build_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.sessionHash, s.launchSessionId, s.gameSessionToken, s.playerId, s.operatorCode, s.jurisdictionCode, s.currency, s.buildVersion, s.expiresAt],
    );
  }

  async findSession(hash: Buffer, now: Date) {
    const { rows } = await this.pool.query(`SELECT * FROM kiln.game_session WHERE session_hash = $1 AND expires_at > $2`, [hash, now]);
    const r = rows[0];
    return r ? {
      sessionHash: r.session_hash, launchSessionId: r.launch_session_id, gameSessionToken: r.game_session_token, playerId: r.player_id,
      operatorCode: r.operator_code, jurisdictionCode: r.jurisdiction_code, currency: r.currency, buildVersion: r.build_version, expiresAt: r.expires_at,
    } : null;
  }

  async openRound(r: Parameters<RoundStore["openRound"]>[0]) {
    const ins = await this.pool.query(
      `INSERT INTO kiln.round (round_id, session_hash, player_id, operator_code, jurisdiction_code, currency, build_version, math_model_sha256, line_bet_minor, stake_minor, stake_txn_id, win_txn_id, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (round_id) DO NOTHING RETURNING *`,
      [r.roundId, r.sessionHash, r.playerId, r.operatorCode, r.jurisdictionCode, r.currency, r.buildVersion, r.mathModelSha256, r.lineBetMinor, r.stakeMinor, r.stakeTxnId, r.winTxnId, r.openedAt],
    );
    if (ins.rows[0]) return { row: toRow(ins.rows[0]), created: true };
    return { row: (await this.getRound(r.roundId))!, created: false };
  }

  async getRound(roundId: string) {
    const { rows } = await this.pool.query(`SELECT * FROM kiln.round WHERE round_id = $1`, [roundId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async markDebited(roundId: string) {
    await this.pool.query(`UPDATE kiln.round SET status = 'debited' WHERE round_id = $1 AND status = 'opened'`, [roundId]);
  }

  async markRejected(roundId: string, reason: string) {
    await this.pool.query(`UPDATE kiln.round SET status = 'rejected', reject_reason = $2 WHERE round_id = $1 AND status IN ('opened', 'debited')`, [roundId, reason]);
  }

  async recordDecision(roundId: string, d: Parameters<RoundStore["recordDecision"]>[1]) {
    await this.pool.query(
      `UPDATE kiln.round SET status = 'decided', stops = $2, outcome = $3, win_minor = $4, decided_at = $5 WHERE round_id = $1 AND status = 'debited'`,
      [roundId, d.stops, JSON.stringify(d.outcome), d.winMinor, d.decidedAt],
    );
  }

  async settle(roundId: string, balanceAfterMinor: number, settledAt: Date, event: Envelope) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const u = await c.query(
        `UPDATE kiln.round SET status = 'settled', balance_after_minor = $2, settled_at = $3 WHERE round_id = $1 AND status = 'decided'`,
        [roundId, balanceAfterMinor, settledAt],
      );
      if (u.rowCount === 1) {
        await c.query(`INSERT INTO kiln.outbox (event_id, event_type, partition_key, payload, occurred_at) VALUES ($1, $2, $3, $4, $5)`,
          [event.eventId, event.eventType, event.partitionKey, JSON.stringify(event), settledAt]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  async unsettledRounds(olderThan: Date, limit: number) {
    const { rows } = await this.pool.query(
      `SELECT * FROM kiln.round WHERE status IN ('opened', 'debited', 'decided') AND opened_at < $1 ORDER BY opened_at LIMIT $2`, [olderThan, limit]);
    return rows.map(toRow);
  }

  /** Outbox feed (suite ADR-0003): cursor is (tx_id, position); in-flight transactions are never skipped. */
  async feed(after: string | null, limit: number) {
    const [tx, pos] = parseCursor(after);
    const { rows } = await this.pool.query(
      `SELECT position, tx_id::text AS tx, payload FROM kiln.outbox
        WHERE (tx_id, position) > ($1::xid8, $2::bigint) AND tx_id < pg_snapshot_xmin(pg_current_snapshot())
        ORDER BY tx_id, position LIMIT $3`, [tx, pos, Math.min(Math.max(limit, 1), 500)]);
    const last = rows.at(-1);
    return { events: rows.map((r) => r.payload as Envelope), next: last ? `${last.tx}:${last.position}` : after ?? "0:0" };
  }
}

export function parseCursor(c: string | null): [string, string] {
  if (!c) return ["0", "0"];
  const m = /^(\d{1,20}):(\d{1,19})$/.exec(c);
  if (!m) throw new RangeError("bad cursor");
  return [m[1]!, m[2]!];
}
