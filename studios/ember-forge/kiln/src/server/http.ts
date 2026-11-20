// HTTP adapter for the game server: the game client's API, the outbox feed for Catwalk and the
// static build (game client, replay renderer, manifest).
import { createServer, type Server } from "node:http";
import { bearer, HttpError, readJson, sameSecret, securityHeaders, sendJson, sendProblem, serveStatic } from "@casino-platform/studio-sdk/http";
import type { LineGameConfig } from "../math/types.ts";
import { SpinError, type SpinService } from "./spin-service.ts";
import type { RoundStore } from "./ports.ts";

export interface HttpOptions {
  service: SpinService;
  store: RoundStore;
  staticDir: string;
  feedToken: string; // stand-in for the platform's mTLS service identity
  gameFrameAncestors: string; // operator lobbies allowed to embed the game
  replayFrameAncestors: string; // Catwalk origin(s) allowed to embed the replay renderer
  buildVersion: string;
  mathModelSha256: string;
  gameConfig: LineGameConfig;
  log?: (msg: string) => void;
}

/** What the client may know: rules and pays, never the strips (they are certified, not secret, but not needed). */
export const clientConfig = (c: LineGameConfig, buildVersion: string, mathModelSha256: string) => ({
  game: c.id, buildVersion, mathModelSha256, reels: c.reels, rows: c.rows, symbols: c.symbols, wild: c.wild, scatter: c.scatter ?? null,
  lines: c.lines, paytable: c.paytable, scatterPays: c.scatterPays ?? null, lineBetsMinor: c.lineBetsMinor,
});

export function createGameServer(o: HttpOptions): Server {
  const csp = (ancestors: string) => securityHeaders(
    `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`);
  const gameHeaders = csp(o.gameFrameAncestors);
  const replayHeaders = csp(o.replayFrameAncestors);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case "GET /healthz":
          return sendJson(res, 200, { ok: true, build: o.buildVersion });
        case "GET /v1/config":
          return sendJson(res, 200, clientConfig(o.gameConfig, o.buildVersion, o.mathModelSha256), { "cache-control": "public, max-age=60" });
        case "POST /v1/sessions": {
          const body = await readJson(req);
          const { sessionToken, session, balanceMinor } = await o.service.openSession(body.launchToken);
          return sendJson(res, 201, {
            sessionToken, expiresAt: session.expiresAt.toISOString(), currency: session.currency,
            balance: { amountMinor: balanceMinor, currency: session.currency }, config: clientConfig(o.gameConfig, o.buildVersion, o.mathModelSha256),
          });
        }
        case "GET /v1/balance":
          return sendJson(res, 200, await o.service.balance(bearer(req)));
        case "POST /v1/spins": {
          const body = await readJson(req, 2_048);
          const r = await o.service.spin(bearer(req), { roundId: body.roundId, lineBetMinor: body.lineBetMinor });
          return sendJson(res, 200, r, r.replayed ? { "idempotent-replay": "true" } : {});
        }
        case "GET /v1/events": {
          if (!sameSecret(bearer(req), o.feedToken)) throw new HttpError(401, "UNAUTHENTICATED", "feed needs the platform service identity");
          const limit = Number(url.searchParams.get("limit") ?? 200);
          let page;
          try { page = await o.store.feed(url.searchParams.get("after"), Number.isFinite(limit) ? limit : 200); }
          catch (e) { if (e instanceof RangeError) throw new HttpError(400, "BAD_CURSOR", e.message); throw e; }
          return sendJson(res, 200, page);
        }
      }
      if (req.method === "GET") {
        const isReplay = url.pathname.startsWith("/replay");
        if (await serveStatic(res, o.staticDir, url.pathname, isReplay ? replayHeaders : gameHeaders)) return;
      }
      sendProblem(res, 404, "NOT_FOUND", `${route} is not a route`);
    } catch (e) {
      if (e instanceof SpinError) return sendProblem(res, e.httpStatus, e.code, e.message);
      if (e instanceof HttpError) return sendProblem(res, e.status, e.code, e.message);
      const status = (e as { httpStatus?: number }).httpStatus;
      if (status === 410) return sendProblem(res, 410, "LAUNCH_USED", "this launch link was already used or has expired; launch again from the lobby");
      o.log?.(`error on ${route}: ${(e as Error).stack ?? e}`);
      sendProblem(res, 500, "INTERNAL", "something went wrong; the round, if any, is safe and can be retried with the same roundId");
    }
  });
}
