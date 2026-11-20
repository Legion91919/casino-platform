// Catwalk HTTP: the player-facing history page and its JSON API.
import { createServer } from "node:http";
import { bearer, HttpError, securityHeaders, sendJson, sendProblem, serveStatic } from "@casino-platform/studio-sdk/http";
import { viewerFromToken, type HistoryService } from "./app/history.ts";
import type { KeyDirectory } from "./app/ports.ts";

export interface CatwalkHttpOptions {
  history: HistoryService;
  keys: KeyDirectory;
  uiDir: string;
  replayOrigins: string; // studio CDN origins whose replay renderers may be framed
  frameAncestors: string; // operator lobbies that may embed the history page
  log?: (m: string) => void;
}

export function createCatwalkServer(o: CatwalkHttpOptions) {
  const pageHeaders = securityHeaders(
    `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${o.replayOrigins}; base-uri 'none'; form-action 'none'; frame-ancestors ${o.frameAncestors}`);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname.startsWith("/v1/me/")) {
        const viewer = await viewerFromToken(bearer(req), o.keys);
        if (url.pathname === "/v1/me/rounds") return sendJson(res, 200, await o.history.list(viewer, url.searchParams));
        if (url.pathname === "/v1/me/summary") return sendJson(res, 200, await o.history.summary(viewer, url.searchParams));
        const m = /^\/v1\/me\/rounds\/([a-z0-9-]+)\/([0-9a-f-]{36})$/.exec(url.pathname);
        if (m) return sendJson(res, 200, await o.history.get(viewer, m[1]!, m[2]!));
      }
      if (req.method === "GET") {
        const path = url.pathname === "/history" || url.pathname === "/" ? "/history.html" : url.pathname;
        if (await serveStatic(res, o.uiDir, path, pageHeaders)) return;
      }
      sendProblem(res, 404, "NOT_FOUND", `${req.method} ${url.pathname} is not a route`);
    } catch (e) {
      if (e instanceof HttpError) return sendProblem(res, e.status, e.code, e.message);
      o.log?.(`catwalk error: ${(e as Error).stack ?? e}`);
      sendProblem(res, 503, "TRY_AGAIN", "your history is temporarily unavailable; your rounds are safe");
    }
  });
}
