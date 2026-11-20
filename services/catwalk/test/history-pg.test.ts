// Catwalk end to end on Postgres: feeds -> ingest -> row-level-secured queries -> HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { freshDatabase, hasPostgres } from "@casino-platform/studio-sdk/testing-pg";
import type { Envelope } from "@casino-platform/studio-sdk";
import { PgHistoryStore } from "../src/adapters/pg-history-store.ts";
import { pollOnce, type Feed } from "../src/app/feeds.ts";
import { HistoryService } from "../src/app/history.ts";
import { createCatwalkServer } from "../src/http.ts";
import { FakeKeys, historyToken, PLAYER_A, PLAYER_B, roundEvent, settledEvent } from "./support/events.ts";

const skip = !hasPostgres() && "set PGHOST (or run via tools/with-postgres.sh) to run Postgres tests";
let pool: pg.Pool, drop: () => Promise<void>, store: PgHistoryStore;
let feedServer: Server, api: Server, base = "";
const feedEvents: Record<string, Envelope[]> = { studio: [], cashier: [] };
const keys = new FakeKeys();

before(async () => {
  if (skip) return;
  const db = await freshDatabase(fileURLToPath(new URL("../db/migrations", import.meta.url)));
  drop = db.drop;
  pool = new pg.Pool({ connectionString: db.url });
  store = new PgHistoryStore(pool);
  feedServer = createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (req.headers.authorization !== "Bearer feed-secret") { res.writeHead(401).end(); return; }
    const list = feedEvents[u.pathname.slice(1)] ?? [];
    const start = Number(u.searchParams.get("after") ?? 0);
    const events = list.slice(start, start + Number(u.searchParams.get("limit")));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ events, next: String(start + events.length) }));
  }).listen(0);
  api = createCatwalkServer({ history: new HistoryService(store, keys), keys, uiDir: fileURLToPath(new URL("../ui", import.meta.url)), replayOrigins: "http://studio.test", frameAncestors: "'self'" }).listen(0);
  base = `http://127.0.0.1:${(api.address() as any).port}`;
});
after(async () => { if (!skip) { feedServer.close(); api.close(); await pool.end(); await drop(); } });

const feed = (name: string): Feed => ({ name, url: `http://127.0.0.1:${(feedServer.address() as any).port}/${name}`, token: "feed-secret" });
const get = (path: string, token?: string) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test("rounds and settlements flow in from both feeds; repeats are applied once", { skip }, async () => {
  const r1 = roundEvent({ winMinor: 120 }), r2 = roundEvent({ winMinor: 0 }), rB = roundEvent({ playerId: PLAYER_B, winMinor: 500 });
  const tampered = roundEvent({ winMinor: 0 });
  (tampered.data as any).win.amountMinor = 0; (tampered.data as any).playerId = PLAYER_B; // re-pointed at another player after signing
  feedEvents.studio!.push(r1, r2, rB, tampered, r1); // r1 delivered twice
  feedEvents.cashier!.push(settledEvent(r1.data.roundId, 120), settledEvent(r2.data.roundId, 900)); // r2: wallet paid 900, game said 0
  assert.deepEqual(await pollOnce(feed("studio"), store, keys), { applied: 4, duplicates: 1 });
  assert.deepEqual(await pollOnce(feed("cashier"), store, keys), { applied: 2, duplicates: 0 });
  assert.deepEqual(await pollOnce(feed("studio"), store, keys), { applied: 0, duplicates: 0 }, "the checkpoint moved past the page");
  const q = await pool.query(`SELECT count(*)::int AS n FROM catwalk.quarantine`);
  assert.equal(q.rows[0].n, 1, "the tampered event is held for on-call, not shown");
});

test("a player's list shows only their rounds, newest first, with the wallet check", { skip }, async () => {
  const res = await get("/v1/me/rounds", historyToken(PLAYER_A));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rounds.length, 2);
  assert.ok(body.rounds.every((r: any) => r.walletCheck !== undefined));
  assert.deepEqual(body.rounds.map((r: any) => r.walletCheck).sort(), ["confirmed", "mismatch"]);
  assert.ok(Date.parse(body.rounds[0].playedAt) >= Date.parse(body.rounds[1].playedAt));
});

test("round detail includes the outcome and where the game's replay renderer lives", { skip }, async () => {
  const list = await (await get("/v1/me/rounds", historyToken(PLAYER_A))).json();
  const r = list.rounds[0];
  const d = await (await get(`/v1/me/rounds/${r.studioCode}/${r.roundId}`, historyToken(PLAYER_A))).json();
  assert.deepEqual(d.outcome.stops, [1, 2, 3, 4, 5]);
  assert.equal(d.replayUrl, "http://studio.test/ember-anvil/1.0.0/replay.html");
  assert.equal(d.signatureVerified, true);
});

test("player B asking for player A's round by id gets the same 404 as a round that doesn't exist", { skip }, async () => {
  const list = await (await get("/v1/me/rounds", historyToken(PLAYER_A))).json();
  const a = list.rounds[0];
  const theirs = await get(`/v1/me/rounds/${a.studioCode}/${a.roundId}`, historyToken(PLAYER_B));
  const none = await get(`/v1/me/rounds/ember-forge/00000000-0000-4000-8000-00000000dead`, historyToken(PLAYER_B));
  assert.equal(theirs.status, 404);
  assert.equal(none.status, 404);
  assert.deepEqual(await theirs.json(), await none.json());
});

test("keyset pagination walks every round exactly once", { skip }, async () => {
  for (let i = 0; i < 7; i++) feedEvents.studio!.push(roundEvent({ winMinor: i * 10, playerId: PLAYER_A }));
  await pollOnce(feed("studio"), store, keys);
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: any = await (await get(`/v1/me/rounds?limit=4${cursor ? `&cursor=${cursor}` : ""}`, historyToken(PLAYER_A))).json();
    seen.push(...page.rounds.map((r: any) => r.roundId));
    cursor = page.next;
  } while (cursor);
  assert.equal(seen.length, 9);
  assert.equal(new Set(seen).size, 9);
});

test("the summary adds up the player's own stakes and wins", { skip }, async () => {
  const s = await (await get(`/v1/me/summary?from=2000-01-01`, historyToken(PLAYER_A))).json();
  assert.equal(s.rounds, 9);
  assert.equal(s.stakeMinor, 9 * 50);
  assert.equal(s.winMinor, 120 + (0 + 10 + 20 + 30 + 40 + 50 + 60));
  assert.equal(s.netMinor, s.winMinor - s.stakeMinor);
});

test("no token, a bad cursor or another operator's token all fail safely", { skip }, async () => {
  assert.equal((await get("/v1/me/rounds")).status, 401);
  assert.equal((await get("/v1/me/rounds?cursor=bogus", historyToken(PLAYER_A))).status, 400);
  const other = await (await get("/v1/me/rounds", historyToken(PLAYER_A, { op: "baobab" }))).json();
  assert.equal(other.rounds.length, 0, "the same player id at another operator sees nothing from Kestrel");
});

test("the history page is served with a CSP that only frames the studio's replay origin", { skip }, async () => {
  const res = await get("/history");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy")!, /frame-src http:\/\/studio\.test;/);
});
