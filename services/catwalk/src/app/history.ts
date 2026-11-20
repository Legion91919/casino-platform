// What a player can ask Catwalk. The viewer comes only from a verified Dealer history token.
import { TokenError, verifyToken, isUuid } from "@casino-platform/studio-sdk";
import { HttpError } from "@casino-platform/studio-sdk/http";
import type { BuildDirectory, HistoryStore, KeyDirectory, Viewer } from "./ports.ts";

export async function viewerFromToken(token: string, keys: KeyDirectory): Promise<Viewer> {
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "open your history from the casino lobby");
  let kid: string | undefined;
  try { kid = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()).kid; } catch { /* verifyToken rejects it */ }
  try {
    const c = verifyToken(token, await keys.dealerKeys(kid), { issuer: "dealer", audience: "catwalk" });
    if (c.scope !== "rounds:read" || typeof c.op !== "string" || !isUuid(c.sub)) throw new TokenError("token does not grant round history");
    return { playerId: c.sub, operatorCode: c.op };
  } catch (e) {
    if (e instanceof TokenError) throw new HttpError(401, "UNAUTHENTICATED", `${e.message}; open your history again from the lobby`);
    throw e;
  }
}

const encodeCursor = (r: { playedAt: string; studioCode: string; roundId: string }) => Buffer.from(JSON.stringify([r.playedAt, r.studioCode, r.roundId])).toString("base64url");
function decodeCursor(s: string) {
  try {
    const [playedAt, studioCode, roundId] = JSON.parse(Buffer.from(s, "base64url").toString());
    if (Number.isNaN(Date.parse(playedAt)) || typeof studioCode !== "string" || !isUuid(roundId)) throw new Error();
    return { playedAt, studioCode, roundId };
  } catch {
    throw new HttpError(400, "BAD_CURSOR", "cursor is not one Catwalk issued");
  }
}
const optTime = (v: string | null, name: string) => {
  if (v === null || v === "") return undefined;
  if (Number.isNaN(Date.parse(v))) throw new HttpError(400, "BAD_QUERY", `${name} must be a date or date-time`);
  return new Date(v).toISOString();
};

export class HistoryService {
  private readonly store: HistoryStore;
  private readonly builds: BuildDirectory;
  constructor(store: HistoryStore, builds: BuildDirectory) {
    this.store = store;
    this.builds = builds;
  }

  async list(viewer: Viewer, params: URLSearchParams) {
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 20) || 20, 1), 50);
    const game = params.get("game");
    if (game !== null && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(game)) throw new HttpError(400, "BAD_QUERY", "game is a game code");
    const rows = await this.store.list(viewer, {
      limit: limit + 1,
      before: params.get("cursor") ? decodeCursor(params.get("cursor")!) : undefined,
      from: optTime(params.get("from"), "from"),
      to: optTime(params.get("to"), "to"),
      gameCode: game ?? undefined,
    });
    const page = rows.slice(0, limit);
    return { rounds: page, next: rows.length > limit ? encodeCursor(page.at(-1)!) : null };
  }

  async get(viewer: Viewer, studioCode: string, roundId: string) {
    if (!isUuid(roundId) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(studioCode)) throw new HttpError(404, "NOT_FOUND", "no such round in your history");
    const r = await this.store.get(viewer, studioCode, roundId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "no such round in your history"); // same answer whether it exists for someone else or not at all
    return { ...r, signatureVerified: true, replayUrl: await this.builds.replayUrl(r.gameCode, r.buildVersion).catch(() => null) };
  }

  async summary(viewer: Viewer, params: URLSearchParams) {
    const to = optTime(params.get("to"), "to") ?? new Date().toISOString();
    const from = optTime(params.get("from"), "from") ?? new Date(Date.parse(to) - 86_400_000).toISOString();
    const s = await this.store.summary(viewer, from, to);
    return { from, to, ...s, netMinor: s.winMinor - s.stakeMinor };
  }
}
