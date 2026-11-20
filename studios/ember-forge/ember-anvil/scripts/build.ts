// Builds an immutable release of Ember Anvil: the game client, the replay renderer, fonts and a
// manifest Dealer stores with the build (entrypoints, every asset with its SHA-256, declared RTP
// and the math model hash). Usage: node scripts/build.ts
// REPLAY_PARENT_ORIGINS (comma-separated) lists the Catwalk origins allowed to drive the replay.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { exactRtp, mathModelSha256 } from "../src/math/rtp.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist/client");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
const parents = (process.env.REPLAY_PARENT_ORIGINS ?? "http://localhost:7401").split(",").map((s) => s.trim()).filter(Boolean);
const sha = mathModelSha256();
const rtp = exactRtp();

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

await build({
  entryPoints: { app: join(root, "src/client/app.ts"), replay: join(root, "src/client/replay.ts") },
  bundle: true, format: "esm", target: "es2022", minify: true, sourcemap: false, outdir: out, logLevel: "warning",
  define: { __MATH_MODEL_SHA256__: JSON.stringify(sha), __BUILD_VERSION__: JSON.stringify(version), __PARENT_ORIGINS__: JSON.stringify(parents) },
});
for (const f of ["index.html", "app.css", "replay.html", "replay.css"]) copyFileSync(join(root, "src/client", f), join(out, f));

const require = createRequire(import.meta.url);
const fonts: [string, string][] = [
  ["@fontsource/big-shoulders-display", "big-shoulders-display-latin-800-normal.woff2"],
  ["@fontsource/atkinson-hyperlegible", "atkinson-hyperlegible-latin-400-normal.woff2"],
  ["@fontsource/atkinson-hyperlegible", "atkinson-hyperlegible-latin-700-normal.woff2"],
];
for (const [pkg, file] of fonts) copyFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), "files", file), join(out, "fonts", file));

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const assets = walk(out).map((f) => ({ path: relative(out, f).split("\\").join("/"), sha256: createHash("sha256").update(readFileSync(f)).digest("hex"), bytes: statSync(f).size }))
  .sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  game: "ember-anvil", studio: "ember-forge", version, category: "slot",
  entrypoint: "index.html", replayEntrypoint: "replay.html",
  rtpBps: rtp.rtpBps, mathModelSha256: sha,
  replayParentOrigins: parents,
  assets,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`built ember-anvil ${version}: ${assets.length} assets, RTP ${(rtp.rtp * 100).toFixed(2)}%, math ${sha.slice(0, 12)}`);
