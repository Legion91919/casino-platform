// Catwalk entrypoint. Configuration from the environment (see the repo's .env.example).
import pg from "pg";
import { fileURLToPath } from "node:url";
import { PgHistoryStore } from "./adapters/pg-history-store.ts";
import { DealerDirectory } from "./adapters/dealer.ts";
import { HistoryService } from "./app/history.ts";
import { startPolling, type Feed } from "./app/feeds.ts";
import { createCatwalkServer } from "./http.ts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing environment variable ${k}`);
  return v;
};

const pool = new pg.Pool({ connectionString: env("CATWALK_DATABASE_URL"), max: 10 });
const store = new PgHistoryStore(pool);
const dealer = new DealerDirectory(env("DEALER_URL"));
// One feed per producer: every studio game server publishing rounds, and Cashier's settlements.
const feeds: Feed[] = JSON.parse(env("CATWALK_FEEDS"));
startPolling(feeds, store, dealer);

const server = createCatwalkServer({
  history: new HistoryService(store, dealer), keys: dealer,
  uiDir: fileURLToPath(new URL("../ui", import.meta.url)),
  replayOrigins: env("CATWALK_REPLAY_ORIGINS"),
  frameAncestors: env("CATWALK_FRAME_ANCESTORS", "'self'"),
  log: (m) => console.error(m),
});
const port = Number(env("CATWALK_PORT", "7401"));
server.listen(port, () => console.log(`catwalk on http://localhost:${port}/history (feeds: ${feeds.map((f) => f.name).join(", ")})`));
