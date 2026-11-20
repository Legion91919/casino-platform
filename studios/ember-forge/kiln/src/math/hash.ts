// Identity of the certified math (server and build only; the browser gets it injected at build time).
import { createHash } from "node:crypto";
import type { LineGameConfig } from "./types.ts";

export function mathModelSha256(c: LineGameConfig, featureRulesVersion = "none"): string {
  const model = { ...c, featureRulesVersion };
  return createHash("sha256").update(JSON.stringify(model)).digest("hex");
}
