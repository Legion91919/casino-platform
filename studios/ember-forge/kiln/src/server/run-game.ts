// Starts a Kiln game server from a game's math and the environment. Each game's src/server.ts is
// a few lines that call this. Configuration: ANVIL_* names kept generic as GAME_* (see .env.example).
import pg from "pg";
import { newSigningKey, signingKeyFromPem, toJwk } from "@casino-platform/studio-sdk";
import { cryptoRng } from "../math/crypto-rng.ts";
import { mathModelSha256 } from "../math/hash.ts";
import type { GameMath } from "../math/types.ts";
import { PgRoundStore } from "./pg-store.ts";
import { CashierWallet, DealerClient } from "./platform-http.ts";
import { SpinService } from "./spin-service.ts";
import { createGameServer } from "./http.ts";

export interface RunGameOptions {
  studioCode: string;
  gameCode: string;
  buildVersion: string;
  math: GameMath;
  featureRulesVersion: string;
  staticDir: string;
  defaultPort: number;
}

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`missing environment variable ${k}`);
  return v;
};

export async function runGameServer(o: RunGameOptions) {
  const hash = mathModelSha256(o.math.config, o.featureRulesVersion);
  const pool = new pg.Pool({ connectionString: env("GAME_DATABASE_URL"), max: 10 });
  const store = new PgRoundStore(pool);
  const dealer = new DealerClient(env("DEALER_URL"), o.gameCode);
  const pem = process.env.GAME_SIGNING_KEY_PEM;
  const signingKey = pem ? signingKeyFromPem(env("GAME_SIGNING_KEY_ID"), pem) : newSigningKey(`${o.studioCode}-${o.gameCode}-dev-${Date.now()}`);
  if (!pem) await dealer.registerSigningKey(o.studioCode, toJwk(signingKey)); // dev only: fresh key per run

  const service = new SpinService({
    store, wallet: new CashierWallet(env("CASHIER_URL")), dealer, rng: cryptoRng, signingKey, clock: () => new Date(),
    studioCode: o.studioCode, gameCode: o.gameCode, buildVersion: o.buildVersion, mathModelSha256: hash, math: o.math,
  });
  const server = createGameServer({
    service, store, buildVersion: o.buildVersion, mathModelSha256: hash, gameConfig: o.math.config, staticDir: o.staticDir,
    feedToken: env("GAME_FEED_TOKEN"),
    gameFrameAncestors: env("GAME_FRAME_ANCESTORS", "'self'"),
    replayFrameAncestors: env("REPLAY_FRAME_ANCESTORS", "'self'"),
    log: (m) => console.error(m),
  });
  const port = Number(env("GAME_PORT", String(o.defaultPort)));
  server.listen(port, () => console.log(`${o.gameCode} ${o.buildVersion} on http://localhost:${port} (math ${hash.slice(0, 12)})`));
  setInterval(() => service.resumeUnsettled().catch((e) => console.error("resume failed", e)), 5_000).unref();
}
