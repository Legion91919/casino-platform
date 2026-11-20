// Postgres adapter. Reads run as catwalk_reader with the verified viewer set for the transaction,
// so row-level security (db/migrations/V001__init.sql) filters every query; a missing WHERE clause
// here cannot leak another player's rounds. Writes run as catwalk_ingest.
import pg from "pg";
import type { Envelope } from "@casino-platform/studio-sdk";
import type { HistoryStore, IngestAction, ListQuery, RoundDetailRow, RoundSummaryRow, Viewer } from "../app/ports.ts";

const COLS = `studio_code, round_id, game_code, build_version, played_at, currency, stake_minor, win_minor,
              balance_after_minor, wallet_check, wallet_win_minor`;

function summaryRow(r: any): RoundSummaryRow {
  return {
    studioCode: r.studio_code, roundId: r.round_id, gameCode: r.game_code, buildVersion: r.build_version,
    playedAt: new Date(r.played_at).toISOString(), currency: r.currency, stakeMinor: Number(r.stake_minor),
    winMinor: Number(r.win_minor), balanceAfterMinor: Number(r.balance_after_minor), walletCheck: r.wallet_check,
    walletWinMinor: r.wallet_win_minor === null ? null : Number(r.wallet_win_minor),
  };
}

export class PgHistoryStore implements HistoryStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  private async tx<T>(role: "catwalk_reader" | "catwalk_ingest", viewer: Viewer | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE ${role}`);
      if (viewer) {
        await c.query(`SELECT set_config('catwalk.operator_code', $1, true), set_config('catwalk.player_id', $2, true)`, [viewer.operatorCode, viewer.playerId]);
      }
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async checkpoint(feed: string) {
    const { rows } = await this.pool.query(`SELECT cursor FROM catwalk.consumer_checkpoint WHERE feed = $1`, [feed]);
    return rows[0]?.cursor ?? null;
  }

  async process(feed: string, event: Envelope, action: IngestAction, cursor: string) {
    return this.tx("catwalk_ingest", null, async (c) => {
      const fresh = await c.query(`INSERT INTO catwalk.inbox (event_id, feed) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [event.eventId, feed]);
      if (fresh.rowCount === 1) {
        if (action.kind === "round") {
          const d = action.round;
          await c.query(
            `INSERT INTO catwalk.round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256,
               jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING`,
            [d.studioCode, d.roundId, d.playedAt, action.operatorCode, d.playerId, d.gameCode, d.buildVersion, d.mathModelSha256, d.jurisdictionCode,
             d.currency, d.stake.amountMinor, d.win.amountMinor, d.balanceAfter.amountMinor, JSON.stringify(d.outcome), JSON.stringify(d.signature), action.eventId]);
        } else if (action.kind === "settlement") {
          const s = action.settlement;
          await c.query(
            `INSERT INTO catwalk.wallet_settlement (operator_code, external_round_id, game_code, player_id, currency, stake_minor, win_minor, settled_at, event_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [s.operatorCode, s.externalRoundId, s.gameCode, s.playerId, s.currency, s.stakeMinor, s.winMinor, s.settledAt, action.eventId]);
        } else if (action.kind === "quarantine") {
          await c.query(`INSERT INTO catwalk.quarantine (event_id, feed, reason, payload) VALUES ($1, $2, $3, $4)`,
            [event.eventId ?? null, feed, action.reason, JSON.stringify(event)]);
        }
      }
      await c.query(
        `INSERT INTO catwalk.consumer_checkpoint (feed, cursor) VALUES ($1, $2)
         ON CONFLICT (feed) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`, [feed, cursor]);
      return fresh.rowCount === 1 ? "applied" : "duplicate";
    });
  }

  async list(viewer: Viewer, q: ListQuery) {
    return this.tx("catwalk_reader", viewer, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLS} FROM catwalk.round_view
          WHERE ($1::timestamptz IS NULL OR played_at >= $1) AND ($2::timestamptz IS NULL OR played_at < $2)
            AND ($3::text IS NULL OR game_code = $3)
            AND ($4::timestamptz IS NULL OR (played_at, studio_code, round_id) < ($4, $5::text, $6::uuid))
          ORDER BY played_at DESC, studio_code DESC, round_id DESC LIMIT $7`,
        [q.from ?? null, q.to ?? null, q.gameCode ?? null, q.before?.playedAt ?? null, q.before?.studioCode ?? null, q.before?.roundId ?? null, q.limit]);
      return rows.map(summaryRow);
    });
  }

  async get(viewer: Viewer, studioCode: string, roundId: string): Promise<RoundDetailRow | null> {
    return this.tx("catwalk_reader", viewer, async (c) => {
      const { rows } = await c.query(
        `SELECT ${COLS}, math_model_sha256, jurisdiction_code, outcome, signature->>'keyId' AS key_id
           FROM catwalk.round_view WHERE studio_code = $1 AND round_id = $2`, [studioCode, roundId]);
      const r = rows[0];
      return r ? { ...summaryRow(r), mathModelSha256: r.math_model_sha256, jurisdictionCode: r.jurisdiction_code, outcome: r.outcome, signatureKeyId: r.key_id } : null;
    });
  }

  async summary(viewer: Viewer, from: string, to: string) {
    return this.tx("catwalk_reader", viewer, async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS rounds, coalesce(sum(stake_minor), 0) AS stake, coalesce(sum(win_minor), 0) AS win,
                coalesce(max(win_minor), 0) AS biggest, min(currency) AS currency
           FROM catwalk.round_view WHERE played_at >= $1 AND played_at < $2`, [from, to]);
      const r = rows[0];
      return { rounds: r.rounds, stakeMinor: Number(r.stake), winMinor: Number(r.win), biggestWinMinor: Number(r.biggest), currency: r.currency };
    });
  }
}
