// kiln import-art: brings generated images into a game's art/ folder.
//   Sheet (one image with every symbol in a grid, which keeps one consistent style):
//     node import-art.ts <game-folder> --sheet sheet.png --grid 4x3 --names ember,crucible,anvil,...
//   Single files (art-inbox/<symbol>.png, background.png):
//     node import-art.ts <game-folder> --dir art-inbox
// Each symbol is cut out, trimmed to its visible pixels, centred on a square transparent canvas
// with a little padding, and saved as art/<symbol>.png, which the build prefers over art/<symbol>.svg.
import sharp from "sharp";
import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const gameDir = resolve(args[0] ?? ".");
const opt = (k: string) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : undefined; };
const game = (await import(pathToFileURL(join(gameDir, "src/game.ts")).href)) as { config: { symbols: readonly string[] } };
const known = new Set([...game.config.symbols, "background"]);

async function squareSymbol(input: Buffer | string, name: string) {
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 12 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.round(Math.max(meta.width!, meta.height!) * 1.08);
  await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed, gravity: "center" }]).resize(512, 512).png().toFile(join(gameDir, "art", `${name}.png`));
  console.log(`  art/${name}.png  (from ${meta.width}x${meta.height})`);
}

const sheet = opt("--sheet");
if (sheet) {
  const [cols, rows] = (opt("--grid") ?? "4x3").split("x").map(Number) as [number, number];
  const names = (opt("--names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!known.has(n)) throw new Error(`"${n}" is not a symbol of this game (${[...known].join(", ")})`);
  const { width, height } = await sharp(sheet).metadata();
  const cw = Math.floor(width! / cols), ch = Math.floor(height! / rows);
  for (const [i, name] of names.entries()) {
    const cell = await sharp(sheet).extract({ left: (i % cols) * cw, top: Math.floor(i / cols) * ch, width: cw, height: ch }).png().toBuffer();
    await squareSymbol(cell, name);
  }
}
const dir = opt("--dir");
if (dir) {
  for (const f of readdirSync(dir).filter((f) => /\.(png|webp|jpe?g)$/i.test(f))) {
    const name = basename(f, extname(f)).toLowerCase();
    if (!known.has(name)) { console.log(`  skipped ${f}: not a symbol of this game`); continue; }
    if (name === "background") await sharp(join(dir, f)).resize(1600, 950, { fit: "cover" }).png().toFile(join(gameDir, "art", "background.png"));
    else await squareSymbol(join(dir, f), name);
  }
}
if (!sheet && !dir) console.log("nothing to import: pass --sheet or --dir");
const missing = [...known].filter((n) => !existsSync(join(gameDir, "art", `${n}.png`)) && !existsSync(join(gameDir, "art", `${n}.svg`)));
if (missing.length) console.log(`still missing art for: ${missing.join(", ")}`);
