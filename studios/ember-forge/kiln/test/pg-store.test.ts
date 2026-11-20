// Runs the spin use case against the real Postgres adapter and schema (needs PGHOST).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { freshDatabase, hasPostgres } from "@casino-platform/studio-sdk/testing-pg";
import { keyRing, newSigningKey, toJwk, unsignedPart, verifyCanonical, type RoundOutcomeData } from "@casino-platform/studio-sdk";
import { mathModelSha256 } from "../src/math/hash.ts";
import { fixtureMath } from "./support/fixture-game.ts";
import { PgRoundStore } from "../src/server/pg-store.ts";
import { SpinService, SpinError } from "../src/server/spin-service.ts";
import { CountingRng, FakeDealer, FakeWallet, LAUNCH_A, PLAYER_A } from "./support/fakes.ts";

const skip = !hasPostgres() && "set PGHOST (or run via tools/with-postgres.sh) to run Postgres tests";
let pool: pg.Pool, drop: () => Promise<void>;

before(async () => {
  if (skip) return;
  const db = await freshDatabase(fileURLToPath(new URL("../db/migrations", import.meta.url)));
  drop = db.drop;
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
});
after(async () => { if (!skip) { await pool.end(); await drop(); } });

function service(wallet = new FakeWallet()) {
  const key = newSigningKey("ember-forge-test");
  const svc = new SpinService({
    store: new PgRoundStore(pool), wallet, dealer: new FakeDealer(), rng: new CountingRng(), signingKey: key, clock: () => new Date(),
    studioCode: "ember-forge", gameCode: "ember-anvil", buildVersion: "1.0.0", mathModelSha256: mathModelSha256(fixtureMath.config), math: fixtureMath,
  });
  return { svc, wallet, ring: keyRing({ keys: [toJwk(key)] }) };
}

test("spins settle in Postgres and their signed events come out of the outbox feed in order", { skip }, async () => {
  const { svc, wallet, ring } = service();
  wallet.balances.set(PLAYER_A, 100_000);
  const { sessionToken } = await svc.openSession(LAUNCH_A);
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  for (const id of ids) await svc.spin(sessionToken, { roundId: id, lineBetMinor: 10 });
  const store = new PgRoundStore(pool);
  const page1 = await store.feed(null, 3);
  const page2 = await store.feed(page1.next, 3);
  const events = [...page1.events, ...page2.events];
  assert.deepEqual(events.map((e) => e.partitionKey), ids);
  for (const e of events) {
    const d = e.data as RoundOutcomeData;
    assert.ok(verifyCanonical(unsignedPart(d), d.signature, ring));
  }
  assert.equal((await store.feed(page2.next, 3)).events.length, 0, "nothing new: the cursor stays put");
});

test("ten concurrent retries of one round debit once, draw once and publish once", { skip }, async () => {
  const { svc, wallet } = service();
  wallet.balances.set(PLAYER_A, 100_000);
  const { sessionToken } = await svc.openSession("A".padEnd(43, "z"));
  const id = crypto.randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => svc.spin(sessionToken, { roundId: id, lineBetMinor: 5 })));
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<any>).value);
  assert.ok(ok.length >= 1);
  assert.equal(new Set(ok.map((r) => JSON.stringify(r.outcome.stops))).size, 1, "every caller saw the same stops");
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kiln.outbox WHERE partition_key = $1`, [id]);
  assert.equal(rows[0].n, 1);
  assert.equal(wallet.balances.get(PLAYER_A), 100_000 - 50 + ok[0].win.amountMinor);
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof SpinError);
});
