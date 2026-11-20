// The dev floor's HTTP side: Dealer double (:7101), Cashier double (:7102) and an invented operator
// lobby (:7100, "Kestrel Gaming") that launches the slot and opens Catwalk for the player.
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { bearer, HttpError, readJson, sameSecret, securityHeaders, sendJson, sendProblem, serveStatic } from "@casino-platform/studio-sdk/http";
import { DealerDouble } from "./dealer-double.ts";
import { CashierDouble } from "./cashier-double.ts";

export const DEMO_PLAYERS = [
  { label: "Player 1001", playerId: "8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b", startingMinor: 25_000 },
  { label: "Player 1002", playerId: "1f2e3d4c-5b6a-4789-8abc-def012345678", startingMinor: 8_000 },
];
export const OPERATOR = { code: "kestrel", name: "Kestrel Gaming", jurisdiction: "JUR-A", currency: "EUR" };

type Handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL) => Promise<unknown> | unknown;

function serve(handler: Handler): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      await handler(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return sendProblem(res, e.status, e.code, e.message);
      console.error(e);
      sendProblem(res, 500, "INTERNAL", "dev floor error");
    }
  });
}

export function createFloor(opts: { feedToken: string; gameOrigins: string[]; catwalkOrigin: string; games?: { code: string; title: string; blurb: string }[] }) {
  const dealer = new DealerDouble();
  const cashier = new CashierDouble(() => dealer.ring());
  for (const p of DEMO_PLAYERS) cashier.cash.set(`${OPERATOR.code}:${p.playerId}`, p.startingMinor);

  const dealerServer = serve(async (req, res, url) => {
    const r = `${req.method} ${url.pathname}`;
    if (r === "GET /.well-known/jwks.json") return sendJson(res, 200, dealer.jwks());
    if (r === "POST /v1/launch-sessions/redeem") return sendJson(res, 200, dealer.redeem(String((await readJson(req)).launchToken ?? "")));
    let m = /^\/v1\/studios\/([a-z0-9-]+)\/signing-keys(?:\/([^/]+))?$/.exec(url.pathname);
    if (m && req.method === "GET" && !m[2]) return sendJson(res, 200, dealer.studioJwks(m[1]!));
    if (m && req.method === "PUT" && m[2]) { dealer.registerStudioKey(m[1]!, decodeURIComponent(m[2]), await readJson(req)); res.writeHead(204); return res.end(); }
    m = /^\/v1\/games\/([a-z0-9-]+)\/builds\/([0-9A-Za-z.+-]+)$/.exec(url.pathname);
    if (m && req.method === "GET") return sendJson(res, 200, dealer.build(m[1]!, m[2]!));
    sendProblem(res, 404, "NOT_FOUND", r);
  });

  const cashierServer = serve(async (req, res, url) => {
    const r = `${req.method} ${url.pathname}`;
    if (r === "GET /v1/events") {
      if (!sameSecret(bearer(req), opts.feedToken)) throw new HttpError(401, "UNAUTHENTICATED", "feed needs the platform service identity");
      return sendJson(res, 200, cashier.feed(url.searchParams.get("after"), Number(url.searchParams.get("limit") ?? 200)));
    }
    if (!r.startsWith("GET /v1/wallet") && !r.startsWith("POST /v1/wallet")) return sendProblem(res, 404, "NOT_FOUND", r);
    if (cashier.faults.walletDown) throw new HttpError(503, "WALLET_DOWN", "dev fault: wallet unavailable");
    const claims = cashier.auth(bearer(req));
    if (r === "GET /v1/wallet/balance") return sendJson(res, 200, cashier.balanceBody(claims));
    const body = await readJson(req);
    const op = { "POST /v1/wallet/debit": "debit", "POST /v1/wallet/credit": "credit", "POST /v1/wallet/rollback": "rollback" }[r] as "debit" | "credit" | "rollback" | undefined;
    if (!op) return sendProblem(res, 404, "NOT_FOUND", r);
    if (op === "credit" && cashier.faults.creditDown) throw new HttpError(503, "WALLET_DOWN", "dev fault: wallet stopped answering after the stake");
    const out = cashier[op](claims, body);
    sendJson(res, out.status, out.body, out.replay ? { "idempotent-replay": "true" } : {});
  });

  const publicDir = fileURLToPath(new URL("../public", import.meta.url));
  const lobbyHeaders = securityHeaders(`default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${opts.gameOrigins.join(" ")} ${opts.catwalkOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  const lobbyServer = serve(async (req, res, url) => {
    const r = `${req.method} ${url.pathname}`;
    const player = (id: unknown) => {
      const p = DEMO_PLAYERS.find((x) => x.playerId === id);
      if (!p) throw new HttpError(400, "UNKNOWN_PLAYER", "pick a demo player");
      return p;
    };
    // The operator's backend: it knows who is logged in and asks Dealer on the player's behalf.
    if (r === "GET /api/players") return sendJson(res, 200, { operator: OPERATOR, players: DEMO_PLAYERS.map(({ label, playerId }) => ({ label, playerId, balance: cashier.cash.get(`${OPERATOR.code}:${playerId}`) ?? 0 })), catwalkOrigin: opts.catwalkOrigin, games: opts.games ?? [], gameOrigins: opts.gameOrigins });
    if (r === "POST /api/launch") {
      const body = await readJson(req);
      const p = player(body.playerId);
      const gameCode = String(body.gameCode ?? "ember-anvil");
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(gameCode)) throw new HttpError(400, "BAD_GAME", "unknown game");
      return sendJson(res, 201, dealer.launch({ playerId: p.playerId, operatorCode: OPERATOR.code, gameCode, jurisdictionCode: OPERATOR.jurisdiction, currency: OPERATOR.currency, returnUrl: `http://${req.headers.host}/` }));
    }
    if (r === "POST /api/history-token") {
      const p = player((await readJson(req)).playerId);
      return sendJson(res, 201, { ...dealer.historyToken({ playerId: p.playerId, operatorCode: OPERATOR.code }), catwalkUrl: `${opts.catwalkOrigin}/history` });
    }
    if (r === "POST /api/faults") {
      const b = await readJson(req);
      if (typeof b.walletDown === "boolean") cashier.faults.walletDown = b.walletDown;
      if (typeof b.creditDown === "boolean") cashier.faults.creditDown = b.creditDown;
      if (Number.isSafeInteger(b.skewNextSettlementMinor)) cashier.faults.skewNextSettlementMinor = b.skewNextSettlementMinor;
      return sendJson(res, 200, cashier.faults);
    }
    if (req.method === "GET" && (await serveStatic(res, publicDir, url.pathname === "/" ? "/lobby.html" : url.pathname, lobbyHeaders))) return;
    sendProblem(res, 404, "NOT_FOUND", r);
  });

  return { dealer, cashier, dealerServer, cashierServer, lobbyServer };
}
