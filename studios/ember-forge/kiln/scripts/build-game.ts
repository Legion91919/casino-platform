// kiln build: turns a game folder into an immutable release in <game>/dist/client:
//   app.js + replay.js (esbuild bundles of the game's client.ts / replay.ts, Pixi and tween.js inside),
//   atlas.png + atlas.json (every symbol from art/<symbol>.png or .svg, packed into one texture),
//   background.png, fonts, index.html, replay.html, and manifest.json for Dealer (asset hashes,
//   declared RTP, math model hash, replay entrypoint).
// Usage: node studios/ember-forge/kiln/scripts/build-game.ts <game-folder>
// REPLAY_PARENT_ORIGINS (comma-separated) lists the Catwalk origins allowed to drive the replay.
import { build } from "esbuild";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exactLineRtp } from "../src/math/rtp.ts";
import { mathModelSha256 } from "../src/math/hash.ts";
import type { GameMath } from "../src/math/types.ts";

const kiln = fileURLToPath(new URL("..", import.meta.url));
const gameDir = resolve(process.argv[2] ?? ".");
const out = join(gameDir, "dist/client");
const pkg = JSON.parse(readFileSync(join(gameDir, "package.json"), "utf8"));
const buildCfg = JSON.parse(readFileSync(join(gameDir, "kiln.build.json"), "utf8")) as {
  title: string; fonts: [string, string][]; symbolSize?: number; backgroundSize?: [number, number];
};
const game = (await import(pathToFileURL(join(gameDir, "src/game.ts")).href)) as {
  math: GameMath; FEATURE_RULES: string; DECLARED_RTP_BPS?: number; GAME: string; STUDIO: string;
};
const parents = (process.env.REPLAY_PARENT_ORIGINS ?? "http://localhost:7401").split(",").map((s) => s.trim()).filter(Boolean);
const hash = mathModelSha256(game.math.config, game.FEATURE_RULES);
const rtpBps = game.FEATURE_RULES === "none" ? exactLineRtp(game.math.config).rtpBps : game.DECLARED_RTP_BPS;
if (!rtpBps) throw new Error("a game with features must export DECLARED_RTP_BPS (from its PAR sheet simulation)");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

// 1. Bundles
await build({
  entryPoints: { app: join(gameDir, "src/client.ts"), replay: join(gameDir, "src/replay.ts") },
  bundle: true, format: "esm", target: "es2022", minify: true, outdir: out, logLevel: "warning", legalComments: "linked",
  define: { __KILN_BUILD__: JSON.stringify({ mathModelSha256: hash, buildVersion: pkg.version, parentOrigins: parents }) },
});

// 2. Sprite atlas: one texture for every symbol (fewer draw calls, one download)
const size = buildCfg.symbolSize ?? 256, pad = 4, cols = 4;
const symbols = game.math.config.symbols;
const source = (name: string) => [join(gameDir, "art", `${name}.png`), join(gameDir, "art", `${name}.svg`)].find(existsSync);
const tiles = await Promise.all(symbols.map(async (s) => {
  const file = source(s);
  if (!file) throw new Error(`no art for symbol "${s}" (art/${s}.png or art/${s}.svg)`);
  return { name: s, input: await sharp(file, { density: 300 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() };
}));
const rows = Math.ceil(tiles.length / cols), cell = size + pad * 2;
const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } }> = {};
const composite = tiles.map((t, i) => {
  const x = (i % cols) * cell + pad, y = Math.floor(i / cols) * cell + pad;
  frames[t.name] = { frame: { x, y, w: size, h: size }, sourceSize: { w: size, h: size } };
  return { input: t.input, left: x, top: y };
});
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composite).png({ compressionLevel: 9 }).toFile(join(out, "atlas.png"));
writeFileSync(join(out, "atlas.json"), JSON.stringify({ frames, meta: { image: "atlas.png", format: "RGBA8888", size: { w: cols * cell, h: rows * cell }, scale: 1 } }));
const [bw, bh] = buildCfg.backgroundSize ?? [1600, 950];
const bgFile = source("background");
if (!bgFile) throw new Error("no art/background.svg or .png");
await sharp(bgFile, { density: 200 }).resize(bw, bh, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(join(out, "background.png"));

// 3. Styles, fonts, pages
copyFileSync(join(kiln, "src/client/kiln.css"), join(out, "kiln.css"));
copyFileSync(join(gameDir, "src/theme.css"), join(out, "theme.css"));
const require = createRequire(join(gameDir, "package.json"));
for (const [p, file] of buildCfg.fonts) copyFileSync(join(dirname(require.resolve(`${p}/package.json`)), "files", file), join(out, "fonts", file));
const page = (title: string, script: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="kiln.css">
  <link rel="stylesheet" href="theme.css">
  <script type="module" src="${script}"></script>
</head>
<body></body>
</html>
`;
writeFileSync(join(out, "index.html"), page(buildCfg.title, "app.js"));
writeFileSync(join(out, "replay.html"), page(`${buildCfg.title} replay`, "replay.js"));

// 4. Manifest
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const assets = walk(out).map((f) => ({ path: relative(out, f).split("\\").join("/"), sha256: createHash("sha256").update(readFileSync(f)).digest("hex"), bytes: statSync(f).size }))
  .sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  game: game.GAME, studio: game.STUDIO, version: pkg.version, category: "slot", framework: "kiln@1",
  entrypoint: "index.html", replayEntrypoint: "replay.html",
  rtpBps, rtpMethod: game.FEATURE_RULES === "none" ? "exact" : "simulated (see docs/par-sheet.md)",
  mathModelSha256: hash, featureRules: game.FEATURE_RULES, replayParentOrigins: parents, assets,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const kb = Math.round(assets.reduce((t, a) => t + a.bytes, 0) / 1024);
console.log(`built ${game.GAME} ${pkg.version} with kiln: ${assets.length} assets, ${kb} KB, RTP ${(rtpBps / 100).toFixed(2)}%, math ${hash.slice(0, 12)}`);
