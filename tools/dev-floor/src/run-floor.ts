// npm run floor: one command for the whole local slot floor.
//   Dealer + Cashier contract doubles and the Kestrel lobby (this process); every Kiln game's
//   server and Catwalk as child processes; PostgreSQL 16 underneath.
// Needs PGHOST etc. (Codespaces: the `db` service; laptop: tools/with-postgres.sh npm run floor).
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createFloor } from "./floor.ts";
import { GAMES, internalUrl, PORTS, publicUrl } from "./urls.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const studio = join(root, "studios/ember-forge");
const catwalkDir = join(root, "services/catwalk");
if (!process.env.PGHOST) {
  console.error("PGHOST is not set. In Codespaces it is set for you; on a laptop run: tools/with-postgres.sh npm run floor");
  process.exit(1);
}
const lobby = publicUrl(PORTS.lobby), catwalk = publicUrl(PORTS.catwalk);
const games = GAMES.map((g) => ({ ...g, dir: join(studio, g.folder), url: publicUrl(g.port) }));
const feedToken = randomBytes(24).toString("base64url"); // per-run stand-in for the platform's mTLS identity

async function ensureDatabase(name: string, migrations: string, schema: string): Promise<string> {
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name])).rowCount) await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const c = new pg.Client({ database: name });
  await c.connect();
  if (!(await c.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [schema])).rowCount) {
    for (const f of readdirSync(migrations).filter((f) => /^V\d+__/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      await c.query(readFileSync(join(migrations, f), "utf8"));
    }
    console.log(`  migrated ${name}`);
  }
  await c.end();
  const { PGHOST, PGPORT = "5432", PGUSER = "postgres", PGPASSWORD } = process.env;
  return `postgres://${PGUSER}${PGPASSWORD ? `:${encodeURIComponent(PGPASSWORD)}` : ""}@${PGHOST}:${PGPORT}/${name}`;
}

console.log("Preparing the slot floor...");
const catwalkDb = await ensureDatabase("catwalk", join(catwalkDir, "db/migrations"), "catwalk");
const floor = createFloor({ feedToken, gameOrigins: games.map((g) => g.url), catwalkOrigin: catwalk, games: games.map(({ code, title, blurb }) => ({ code, title, blurb })) });
const dbUrls: Record<string, string> = {};
for (const g of games) {
  dbUrls[g.code] = await ensureDatabase(g.db, join(studio, "kiln/db/migrations"), "kiln"); // every Kiln game uses the same schema, in its own database
  execFileSync(process.execPath, [join(studio, "kiln/scripts/build-game.ts"), g.dir], { stdio: "inherit", env: { ...process.env, REPLAY_PARENT_ORIGINS: catwalk } });
  const m = JSON.parse(readFileSync(join(g.dir, "dist/client/manifest.json"), "utf8"));
  floor.dealer.publish({ gameCode: g.code, studioCode: "ember-forge", version: m.version, assetBaseUrl: `${g.url}/`, replayEntrypoint: m.replayEntrypoint, rtpBps: m.rtpBps, mathModelSha256: m.mathModelSha256 });
}
await Promise.all([
  new Promise<void>((ok) => floor.dealerServer.listen(PORTS.dealer, ok)),
  new Promise<void>((ok) => floor.cashierServer.listen(PORTS.cashier, ok)),
  new Promise<void>((ok) => floor.lobbyServer.listen(PORTS.lobby, ok)),
]);

const children: ChildProcess[] = [];
function start(name: string, cwd: string, entry: string, env: Record<string, string>) {
  const child = spawn(process.execPath, [entry], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (s: Buffer) => s.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  child.stdout!.on("data", tag);
  child.stderr!.on("data", tag);
  child.on("exit", (code) => { if (code) console.log(`[${name}] exited with ${code}`); });
  children.push(child);
}
for (const g of games) {
  start(g.code, g.dir, "src/server.ts", {
    GAME_DATABASE_URL: dbUrls[g.code]!, GAME_PORT: String(g.port), DEALER_URL: internalUrl(PORTS.dealer), CASHIER_URL: internalUrl(PORTS.cashier),
    GAME_FEED_TOKEN: feedToken, GAME_FRAME_ANCESTORS: lobby,
    REPLAY_FRAME_ANCESTORS: `${catwalk} ${lobby}`, // frame-ancestors checks every ancestor: Catwalk and the lobby that embeds it
  });
}
await new Promise((ok) => setTimeout(ok, 1800)); // game servers register their signing keys at Dealer on boot
start("catwalk", catwalkDir, "src/main.ts", {
  CATWALK_DATABASE_URL: catwalkDb, CATWALK_PORT: String(PORTS.catwalk), DEALER_URL: internalUrl(PORTS.dealer),
  CATWALK_FEEDS: JSON.stringify([
    ...games.map((g) => ({ name: g.code, url: `${internalUrl(g.port)}/v1/events`, token: feedToken })),
    { name: "cashier", url: `${internalUrl(PORTS.cashier)}/v1/events`, token: feedToken },
  ]),
  CATWALK_REPLAY_ORIGINS: games.map((g) => g.url).join(" "), CATWALK_FRAME_ANCESTORS: lobby,
});

console.log(`\nSlot floor is up. Open the lobby: ${lobby}\n  ${games.map((g) => `${g.title} ${g.url}`).join("\n  ")}\n  Catwalk ${catwalk}/history\n`);
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
