// The spin use case. Order matters and is the whole point of this file:
//   1. open the round (client-chosen roundId = idempotency key; wallet txn ids minted now)
//   2. debit the stake            -> rejected: round rejected, nothing drawn
//   3. draw the stops and FREEZE the outcome in the database
//   4. credit the win (zero too)  -> wallet down: the round waits; a retry pays the SAME outcome
//   5. settle + signed RoundOutcomeRecorded event in one transaction (outbox)
// Any step can be retried with the same roundId and continues from where the round is.
import { createHash, randomBytes } from "node:crypto";
import { isUuid, signCanonical, uuidv7, type Envelope, type RoundOutcomeData, type SigningKey, type SlotOutcome } from "@casino-platform/studio-sdk";
import { toOutcome } from "../math/game.ts";
import { drawStops, type Rng } from "../math/rng.ts";
import type { GameMath } from "../math/types.ts";
import { WalletUnavailable, type DealerPort, type GameSession, type RoundRow, type RoundStore, type WalletPort } from "./ports.ts";

export class SpinError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface SpinResult {
  roundId: string;
  stake: { amountMinor: number; currency: string };
  win: { amountMinor: number; currency: string };
  balanceAfter: { amountMinor: number; currency: string };
  outcome: SlotOutcome;
  playedAt: string;
  replayed: boolean;
}

export interface SpinDeps {
  store: RoundStore;
  wallet: WalletPort;
  dealer: DealerPort;
  rng: Rng;
  signingKey: SigningKey;
  clock: () => Date;
  studioCode: string;
  gameCode: string;
  buildVersion: string;
  mathModelSha256: string;
  math: GameMath;
  sessionHours?: number;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest();

export class SpinService {
  private readonly d: SpinDeps;
  constructor(deps: SpinDeps) {
    this.d = deps;
  }

  /** Launch: redeem Dealer's single-use token, keep the game-session token server-side, give the client an opaque one. */
  async openSession(launchToken: string): Promise<{ sessionToken: string; session: GameSession; balanceMinor: number }> {
    if (typeof launchToken !== "string" || launchToken.length < 43) throw new SpinError("BAD_LAUNCH_TOKEN", 400, "launch token missing");
    const { gameSessionToken, claims } = await this.d.dealer.redeem(launchToken);
    if (claims.gameCode !== this.d.gameCode) throw new SpinError("WRONG_GAME", 403, "launch token is for another game");
    if (claims.buildVersion !== this.d.buildVersion) throw new SpinError("WRONG_BUILD", 403, `Dealer launched build ${claims.buildVersion}; this server runs ${this.d.buildVersion}`);
    const sessionToken = randomBytes(32).toString("base64url");
    const now = this.d.clock();
    const maxEnd = new Date(now.getTime() + (this.d.sessionHours ?? 4) * 3_600_000);
    const session: GameSession = {
      sessionHash: hashToken(sessionToken),
      launchSessionId: claims.launchSessionId,
      gameSessionToken,
      playerId: claims.playerId,
      operatorCode: claims.operatorCode,
      jurisdictionCode: claims.jurisdictionCode,
      currency: claims.currency,
      buildVersion: claims.buildVersion,
      expiresAt: claims.expiresAt < maxEnd ? claims.expiresAt : maxEnd,
    };
    await this.d.store.saveSession(session);
    const balance = await this.d.wallet.balance(session);
    return { sessionToken, session, balanceMinor: balance.amountMinor };
  }

  async session(sessionToken: string): Promise<GameSession> {
    const s = typeof sessionToken === "string" && sessionToken.length > 0 ? await this.d.store.findSession(hashToken(sessionToken), this.d.clock()) : null;
    if (!s) throw new SpinError("SESSION_EXPIRED", 401, "game session expired; relaunch from the lobby");
    return s;
  }

  async balance(sessionToken: string) {
    const s = await this.session(sessionToken);
    return this.d.wallet.balance(s);
  }

  async spin(sessionToken: string, req: { roundId: unknown; lineBetMinor: unknown }): Promise<SpinResult> {
    const session = await this.session(sessionToken);
    if (!isUuid(req.roundId)) throw new SpinError("BAD_ROUND_ID", 400, "roundId must be a UUID");
    const { lineBetsMinor, lines } = this.d.math.config;
    if (typeof req.lineBetMinor !== "number" || !lineBetsMinor.includes(req.lineBetMinor)) {
      throw new SpinError("BAD_BET", 400, `line bet must be one of ${lineBetsMinor.join(", ")}`);
    }
    const now = this.d.clock();
    const { row, created } = await this.d.store.openRound({
      roundId: req.roundId,
      sessionHash: session.sessionHash,
      playerId: session.playerId,
      operatorCode: session.operatorCode,
      jurisdictionCode: session.jurisdictionCode,
      currency: session.currency,
      buildVersion: this.d.buildVersion,
      mathModelSha256: this.d.mathModelSha256,
      lineBetMinor: req.lineBetMinor,
      stakeMinor: req.lineBetMinor * lines.length,
      stakeTxnId: uuidv7(now.getTime()),
      winTxnId: uuidv7(now.getTime() + 1),
      openedAt: now,
    });
    // Never reveal whether another player's round exists: same answer as any other clash.
    if (!row.sessionHash.equals(session.sessionHash)) throw new SpinError("ROUND_ID_CONFLICT", 409, "roundId already used");
    if (!created && row.lineBetMinor !== req.lineBetMinor) throw new SpinError("ROUND_ID_CONFLICT", 409, "roundId already used with a different bet");
    return this.drive(row, session, { background: false, replay: !created });
  }

  /** Background worker: finish rounds a crash or wallet outage left half-done. Never takes a new stake. */
  async resumeUnsettled(olderThanMs = 10_000, limit = 50): Promise<{ resumed: number; failed: number }> {
    const rows = await this.d.store.unsettledRounds(new Date(this.d.clock().getTime() - olderThanMs), limit);
    let resumed = 0, failed = 0;
    for (const row of rows) {
      const session = await this.d.store.findSession(row.sessionHash, new Date(0)); // expired sessions still settle
      if (!session) { failed++; continue; }
      try { await this.drive(row, session, { background: true, replay: true }); resumed++; } catch { failed++; }
    }
    return { resumed, failed };
  }

  private async drive(row: RoundRow, session: GameSession, mode: { background: boolean; replay: boolean }): Promise<SpinResult> {
    const money = (amountMinor: number) => ({ amountMinor, currency: row.currency });
    const base = { roundId: row.roundId, gameCode: this.d.gameCode };

    if (row.status === "rejected") throw new SpinError(row.rejectReason ?? "REJECTED", 422, `stake was not accepted (${row.rejectReason})`);
    if (row.status === "settled") return this.result(row, true);

    if (row.status === "opened") {
      if (mode.background) {
        // Nobody is waiting for this round any more: undo a stake that may or may not have landed.
        const rb = await this.d.wallet.rollback(session, { ...base, transactionId: uuidv7(this.d.clock().getTime()), referenceTransactionId: row.stakeTxnId });
        if (rb.status === "accepted") await this.d.store.markRejected(row.roundId, "ABANDONED_ROLLED_BACK");
        throw new SpinError("ABANDONED", 410, "round abandoned and rolled back");
      }
      let debit;
      try {
        debit = await this.d.wallet.debit(session, { ...base, transactionId: row.stakeTxnId, amount: money(row.stakeMinor) });
      } catch (e) {
        if (!(e instanceof WalletUnavailable)) throw e;
        try {
          const rb = await this.d.wallet.rollback(session, { ...base, transactionId: uuidv7(this.d.clock().getTime()), referenceTransactionId: row.stakeTxnId });
          if (rb.status === "accepted") await this.d.store.markRejected(row.roundId, "WALLET_UNAVAILABLE");
        } catch { /* left opened: the resumer rolls it back */ }
        throw new SpinError("WALLET_UNAVAILABLE", 503, "the wallet did not answer; no stake was taken");
      }
      if (debit.status === "rejected") {
        await this.d.store.markRejected(row.roundId, debit.code);
        throw new SpinError(debit.code, 422, `stake not accepted: ${debit.code}`);
      }
      await this.d.store.markDebited(row.roundId);
      row = { ...row, status: "debited" };
    }

    if (row.status === "debited") {
      const decidedAt = this.d.clock();
      const { config } = this.d.math;
      // The whole round (paid spin and any free respins) is drawn and frozen in one go.
      const round = this.d.math.playRound(() => drawStops(this.d.rng, config.strips), row.lineBetMinor);
      const outcome = toOutcome(round, row.lineBetMinor, row.currency, config.lines.length) as unknown as SlotOutcome;
      await this.d.store.recordDecision(row.roundId, { stops: round.steps[0]!.stops, outcome, winMinor: round.totalWinMinor, decidedAt });
      row = (await this.d.store.getRound(row.roundId))!; // a concurrent request may have decided first: use what is stored
    }

    if (row.status === "decided") {
      let credit;
      try {
        credit = await this.d.wallet.credit(session, { ...base, transactionId: row.winTxnId, amount: money(row.winMinor!), closeRound: true });
      } catch (e) {
        if (!(e instanceof WalletUnavailable)) throw e;
        throw new SpinError("ROUND_PENDING", 503, "your result is saved and will be paid when the wallet is back");
      }
      if (credit.status === "rejected") throw new SpinError("CREDIT_REFUSED", 502, `wallet refused the win: ${credit.code}`);
      const settledAt = this.d.clock();
      await this.d.store.settle(row.roundId, credit.balanceMinor, settledAt, this.event({ ...row, balanceAfterMinor: credit.balanceMinor, settledAt }, session));
      row = (await this.d.store.getRound(row.roundId))!;
    }
    return this.result(row, mode.replay);
  }

  private event(row: RoundRow, session: GameSession): Envelope<RoundOutcomeData> {
    const money = (amountMinor: number) => ({ amountMinor, currency: row.currency });
    const unsigned = {
      roundId: row.roundId,
      studioCode: this.d.studioCode,
      gameCode: this.d.gameCode,
      buildVersion: row.buildVersion,
      mathModelSha256: row.mathModelSha256,
      jurisdictionCode: row.jurisdictionCode,
      playerId: row.playerId,
      currency: row.currency,
      stake: money(row.stakeMinor),
      win: money(row.winMinor!),
      balanceAfter: money(row.balanceAfterMinor!),
      outcome: row.outcome!,
      playedAt: row.decidedAt!.toISOString(),
    };
    return {
      eventId: crypto.randomUUID(),
      eventType: "RoundOutcomeRecorded",
      schemaVersion: 1,
      occurredAt: row.settledAt!.toISOString(),
      producer: "studio",
      operatorCode: session.operatorCode,
      partitionKey: row.roundId,
      data: { ...unsigned, signature: signCanonical(unsigned, this.d.signingKey) },
    };
  }

  private result(row: RoundRow, replayed: boolean): SpinResult {
    const money = (amountMinor: number) => ({ amountMinor, currency: row.currency });
    return {
      roundId: row.roundId,
      stake: money(row.stakeMinor),
      win: money(row.winMinor!),
      balanceAfter: money(row.balanceAfterMinor!),
      outcome: row.outcome!,
      playedAt: row.decidedAt!.toISOString(),
      replayed,
    };
  }
}
