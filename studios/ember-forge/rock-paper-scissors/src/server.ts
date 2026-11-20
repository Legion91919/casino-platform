// Land of Rock Paper Scissors game server: Kiln's server kit with this game's math and rules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runGameServer } from "@ember-forge/kiln/server";
import { FEATURE_RULES, GAME, math, STUDIO } from "./game.ts";

await runGameServer({
  studioCode: STUDIO, gameCode: GAME, math, featureRulesVersion: FEATURE_RULES,
  buildVersion: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  staticDir: fileURLToPath(new URL("../dist/client", import.meta.url)),
  defaultPort: 7302,
});
