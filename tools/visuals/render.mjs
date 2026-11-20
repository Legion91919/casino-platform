#!/usr/bin/env node
// Renders the design diagrams (Mermaid blocks in the docs, the single source) to docs/media/*.svg + *.png,
// and a step-through GIF of the full bet round (docs/media/bet-round.gif).
//
//   cd tools/visuals && npm install && node render.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const media = join(root, "docs/media");
mkdirSync(media, { recursive: true });

// First ```mermaid block after a marker line in a doc.
function mermaidAfter(doc, marker) {
  const text = readFileSync(join(root, doc), "utf8");
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`${marker} not found in ${doc}`);
  const m = text.slice(at).match(/```mermaid\n([\s\S]*?)```/);
  return m[1];
}
const diagrams = [
  // Top-to-bottom reads better than the doc's left-to-right once the long edge labels are drawn.
  { name: "context-map", src: mermaidAfter(".agentic/architecture.md", "## Context map").replace(/^flowchart LR/, "flowchart TB") },
  { name: "containers", src: mermaidAfter("docs/DESIGN.md", "**C4 containers**") },
  { name: "bet-round", src: mermaidAfter("docs/DESIGN.md", "### 6.1 A full bet round") },
  { name: "data-flow", src: mermaidAfter("docs/DESIGN.md", "## 7. Data flow") },
  { name: "team-topology", src: mermaidAfter("docs/team-topology.md", "## Interaction modes") },
  { name: "slot-publish", src: mermaidAfter("docs/DESIGN.md", "### 15.2 Publish") },
  { name: "slot-play", src: mermaidAfter("docs/DESIGN.md", "### 15.3 Play") },
  { name: "round-review", src: mermaidAfter("docs/DESIGN.md", "### 15.4 Review") },
];

const config = {
  startOnLoad: false, theme: "base", securityLevel: "strict",
  themeVariables: {
    fontFamily: "Inter, 'DejaVu Sans', Arial, sans-serif", fontSize: "16px", background: "#ffffff",
    primaryColor: "#eef3fb", primaryBorderColor: "#4a6fa5", primaryTextColor: "#1f2a37", lineColor: "#5b6b82",
    secondaryColor: "#f6f8fb", tertiaryColor: "#ffffff", clusterBkg: "#f7f9fc", clusterBorder: "#b8c4d6",
    actorBkg: "#eef3fb", actorBorder: "#4a6fa5", signalColor: "#3c4a5e", signalTextColor: "#1f2a37",
    noteBkgColor: "#fff8dc", noteBorderColor: "#c9a227", sequenceNumberColor: "#ffffff", edgeLabelBackground: "#ffffff",
  },
  flowchart: { htmlLabels: false, curve: "basis", useMaxWidth: false, nodeSpacing: 70, rankSpacing: 70, padding: 12 },
  sequence: { useMaxWidth: false, mirrorActors: false, messageMargin: 30, boxMargin: 8, noteMargin: 8, wrap: true, width: 170, actorMargin: 36, messageFontSize: 15 },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="stage" style="display:inline-block;padding:28px;background:#fff"></div></body></html>`);
await page.addScriptTag({ path: join(here, "node_modules/mermaid/dist/mermaid.min.js") });
await page.evaluate(c => window.mermaid.initialize(c), config);

for (const d of diagrams) {
  const svg = await page.evaluate(async ({ name, src }) => (await window.mermaid.render(`m-${name}`, src)).svg, d);
  writeFileSync(join(media, `${d.name}.svg`), svg.replace(/^<svg /, '<svg style="background:#ffffff" '));
  await page.evaluate(svg => { document.getElementById("stage").innerHTML = svg; }, svg);
  await page.locator("#stage").screenshot({ path: join(media, `${d.name}.png`) });
  console.log(`${d.name}.svg / .png`);
}

if (process.argv[2] === "--diagrams") { await browser.close(); process.exit(0); }
// Bet-round GIF: one frame per stage, the stage's messages highlighted, the rest dimmed, actors pinned on top.
const stages = [
  [1, 6, "1. Launch", "Operator asks Dealer for a launch; Dealer checks the player with Pitboss (fail closed), picks the build, returns a single-use token."],
  [7, 9, "2. Redeem", "The game server swaps the single-use launch token for a signed game-session JWT (ES256)."],
  [10, 17, "3. Stake", "Debit: Cashier verifies the JWT, checks the idempotency key, Pitboss authorises the stake, one transaction writes ledger + round + outbox."],
  [18, 21, "4. Win", "Credit: one transaction posts the win, closes the round and writes BetSettled to the outbox."],
  [22, 24, "5. Feed to Comps", "After commit, Comps polls Cashier's outbox feed; inbox(eventId) and the wagering update share one transaction."],
  [25, 30, "6. Feed to Countroom and Pitboss", "Countroom stores raw events and de-duplicated bet facts; Pitboss counts net loss against the player's limits."],
];
const betSvg = readFileSync(join(media, "bet-round.svg"), "utf8");
const FW = 1280, FH = 800;
const frames = join(media, ".tmp-frames");
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames);
const fpage = await browser.newPage({ viewport: { width: FW, height: FH }, deviceScaleFactor: 1 });
await fpage.setContent(`<!doctype html><html><head><style>
  body{margin:0;width:${FW}px;height:${FH}px;background:#fff;font-family:Inter,'DejaVu Sans',Arial,sans-serif;overflow:hidden}
  .head{height:96px;box-sizing:border-box;padding:16px 28px;background:#1f2a37;color:#fff}
  .head b{font-size:26px} .head span{display:block;font-size:17px;color:#d6deea;margin-top:6px}
  .actors,.band{position:relative;overflow:hidden;margin:0 auto} .actors{border-bottom:1px solid #d8dee8}
  .actors>div,.band>div{position:absolute;left:0;transform-origin:0 0}
  .dim{opacity:.16}
</style></head><body><div class="head"><b id="t"></b><span id="d"></span></div><div class="actors" id="a"><div></div></div><div class="band" id="b"><div></div></div></body></html>`);
await fpage.evaluate(svg => { for (const id of ["a", "b"]) document.querySelector(`#${id}>div`).innerHTML = svg; }, betSvg);
for (const [i, [from, to, title, desc]] of stages.entries()) {
  await fpage.evaluate(({ from, to, title, desc, FW, FH }) => {
    document.getElementById("t").textContent = title;
    document.getElementById("d").textContent = desc;
    const svgs = [...document.querySelectorAll("svg")];
    for (const svg of svgs) {
      // One line (or self-loop path) and one number per message; a wrapped label is several <text>s above its line.
      const lines = [...svg.querySelectorAll(".messageLine0, .messageLine1")];
      const nums = [...svg.querySelectorAll("text.sequenceNumber")];
      const tops = lines.map(l => l.getBBox().y);
      const owner = el => { const y = el.getBBox().y; const k = tops.findIndex(t => t >= y - 4); return k < 0 ? lines.length - 1 : k; };
      const on = k => k + 1 >= from && k + 1 <= to;
      lines.forEach((l, k) => {
        const n = nums[k], dot = n?.previousElementSibling; // the number's circle is a marker on its own line
        for (const x of [l, n, dot?.getAttribute("marker-start") ? dot : null]) x?.classList.toggle("dim", !on(k));
      });
      svg.querySelectorAll("text.messageText").forEach(el => el.classList.toggle("dim", !on(owner(el))));
      svg.querySelectorAll(".note, .noteText").forEach(n => n.classList.toggle("dim", from < 18));
      svg.querySelectorAll("line.actor-line, line[class*='actor-line']").forEach(l => l.setAttribute("stroke-opacity", ".5"));
    }
    // Scale 1 (readable), panned to the stage: horizontally to the actors it involves, vertically to its messages.
    const svg = svgs[1], vb = svg.viewBox.baseVal;
    const items = [...svg.querySelectorAll(".messageLine0:not(.dim), .messageLine1:not(.dim), text.messageText:not(.dim)")];
    const boxes = items.map(el => el.getBBox());
    const xs = boxes.flatMap(b => [b.x - vb.x, b.x + b.width - vb.x]);
    const ys = boxes.flatMap(b => [b.y - vb.y, b.y + b.height - vb.y]);
    const actorRects = [...svg.querySelectorAll("rect.actor")];
    const headerH = Math.max(...actorRects.map(r => r.y.baseVal.value + r.height.baseVal.value)) - vb.y + 8;
    const viewW = FW, bandH = FH - 96 - headerH;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const tx = Math.max(0, Math.min(cx - viewW / 2, vb.width - viewW));
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ty = Math.max(headerH, Math.min(cy - bandH / 2, vb.height - bandH));
    const a = document.getElementById("a"), b = document.getElementById("b");
    a.style.width = b.style.width = `${viewW}px`;
    a.style.height = `${headerH}px`;
    b.style.height = `${bandH}px`;
    a.firstElementChild.style.transform = `translateX(${-tx}px)`;
    b.firstElementChild.style.transform = `translate(${-tx}px, ${-ty}px)`;
  }, { from, to, title, desc, FW, FH });
  await fpage.screenshot({ path: join(frames, `f${i}.png`) });
}
await browser.close();
const gif = join(media, "bet-round.gif");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1/4", "-i", join(frames, "f%d.png"), "-vf",
  "fps=1,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none", "-loop", "0", gif]);
rmSync(frames, { recursive: true, force: true });
console.log(`bet-round.gif  ${(statSync(gif).size / 1048576).toFixed(2)} MB`);
