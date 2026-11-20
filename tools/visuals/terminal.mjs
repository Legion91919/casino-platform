#!/usr/bin/env node
// Records a terminal-style replay of real, captured command output as MP4 + GIF (or one PNG).
// For projects without a UI: capture the commands' real output first, then replay it here.
//
//   node terminal.mjs <session.json> <out-dir> <name> [--still]
//
// session.json: { "title": "window title", "prompt": "~/repo $", "width": 1100, "height": 680,
//   "highlight": [["regex", "css colour"], ...],
//   "steps": [ { "caption": "shown under the window", "cmd": "typed command (omit to continue the last output)", "out": "captured output",
//                "clear": true, "hold": 2500, "prompt": "optional per-step prompt" } ] }
// Writes <out-dir>/<name>.mp4 and <name>.gif, or <name>.png with --still (all steps, no animation).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const [sessionPath, outArg, name = "terminal", flag] = process.argv.slice(2);
if (!sessionPath || !outArg) { console.error("usage: node terminal.mjs <session.json> <out-dir> <name> [--still]"); process.exit(2); }
const s = JSON.parse(readFileSync(sessionPath, "utf8"));
const out = resolve(outArg);
const still = flag === "--still";
const W = s.width ?? 1100, H = s.height ?? 680;
mkdirSync(out, { recursive: true });

const page_html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#1b1f2a;font-family:"DejaVu Sans Mono","Liberation Mono",monospace}
  .wrap{box-sizing:border-box;height:100%;padding:22px 26px 0;display:flex;flex-direction:column}
  .win{flex:1;min-height:0;display:flex;flex-direction:column;background:#0f131b;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.45);overflow:hidden;border:1px solid #2a3140}
  .bar{height:34px;flex:none;display:flex;align-items:center;gap:8px;padding:0 14px;background:#202634;color:#9aa4b8;font:600 13px system-ui,sans-serif}
  .dot{width:12px;height:12px;border-radius:50%}.t{flex:1;text-align:center;margin-right:60px}
  #term{flex:1;overflow:hidden;padding:14px 18px;color:#d5dbe6;font-size:${s.fontSize ?? 15}px;line-height:1.42;white-space:pre-wrap;word-break:break-word}
  .p{color:#7fd4a8}.c{color:#fff}.cur{display:inline-block;width:.6em;background:#d5dbe6;animation:b 1s steps(1) infinite}
  @keyframes b{50%{opacity:0}} .dim{color:#7c8699}
  .cap{flex:none;height:${still ? 14 : 58}px;display:flex;align-items:center;justify-content:center;color:#e8ecf3;font:600 17px system-ui,sans-serif}
</style></head><body><div class="wrap"><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="t" id="title"></span></div><div id="term"></div></div><div class="cap" id="cap"></div></div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: still ? 2 : 1,
  ...(still ? {} : { recordVideo: { dir: join(out, ".tmp-video"), size: { width: W, height: H } } }),
});
const page = await ctx.newPage();
await page.setContent(page_html);
await page.evaluate(async ({ s, still }) => {
  const term = document.getElementById("term"), cap = document.getElementById("cap");
  document.getElementById("title").textContent = s.title ?? "terminal";
  const rules = (s.highlight ?? []).map(([re, colour]) => [new RegExp(re), colour]);
  const sleep = ms => new Promise(r => setTimeout(r, still ? 0 : ms));
  const esc = t => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const colour = line => { for (const [re, c] of rules) if (re.test(line)) return `<span style="color:${c}">${esc(line)}</span>`; return esc(line); };
  const scroll = () => { term.scrollTop = term.scrollHeight; };
  for (const step of s.steps) {
    if (step.clear && !still) { await sleep(150); term.innerHTML = ""; }
    if (step.caption !== undefined && !still) cap.textContent = step.caption;
    if (step.cmd !== undefined) { // a step without cmd continues the previous command's output
      const line = document.createElement("div");
      line.innerHTML = `<span class="p">${esc(step.prompt ?? s.prompt ?? "$")}</span> <span class="c"></span><span class="cur">&nbsp;</span>`;
      term.appendChild(line); scroll();
      const c = line.querySelector(".c");
      await sleep(500);
      for (const ch of step.cmd) { c.textContent += ch; await sleep(step.cmd.length > 70 ? 18 : 34); }
      await sleep(350);
      line.querySelector(".cur").remove();
    }
    const lines = (step.out ?? "").replace(/\s+$/, "").split("\n");
    for (const l of step.out ? lines : []) {
      const d = document.createElement("div"); d.innerHTML = colour(l) || "&nbsp;"; term.appendChild(d); scroll();
      await sleep(lines.length > 12 ? 28 : 70);
    }
    await sleep(step.hold ?? 1600 + 60 * Math.min(lines.length, 30));
  }
  if (!still) { const end = document.createElement("div"); end.innerHTML = `<span class="p">${esc(s.steps.at(-1)?.prompt ?? s.prompt ?? "$")}</span> <span class="cur">&nbsp;</span>`; term.appendChild(end); scroll(); await sleep(1500); }
}, { s, still });

if (still) {
  await page.screenshot({ path: join(out, `${name}.png`) });
  await browser.close();
} else {
  const video = page.video();
  await ctx.close(); await browser.close();
  const webm = await video.path();
  const mp4 = join(out, `${name}.mp4`), gif = join(out, `${name}.gif`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", mp4]);
  const fps = s.gifFps ?? 8, scale = s.gifWidth ?? Math.min(W, 960);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf",
    `fps=${fps},scale=${scale}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, gif]);
  rmSync(join(out, ".tmp-video"), { recursive: true, force: true });
  for (const f of [mp4, gif]) console.log(`${f}  ${(statSync(f).size / 1048576).toFixed(2)} MB`);
}
if (still) console.log(join(out, `${name}.png`));
