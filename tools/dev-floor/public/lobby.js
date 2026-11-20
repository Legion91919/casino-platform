// Demo operator lobby. The operator's backend (floor.ts /api/*) asks Dealer for launch URLs and
// history tokens on behalf of the signed-in player; the game and Catwalk run in their own origins.
const $ = (id) => document.getElementById(id);
let state = null;
const money = (m) => new Intl.NumberFormat(undefined, { style: "currency", currency: state.operator.currency }).format(m / 100);
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

async function refresh() {
  state = await (await fetch("/api/players")).json();
  const sel = $("player");
  if (!sel.options.length) for (const p of state.players) sel.add(new Option(p.label, p.playerId));
  const me = state.players.find((p) => p.playerId === sel.value);
  $("cash").textContent = money(me.balance);
  tiles();
}

function tiles() {
  const host = $("tiles");
  if (host.children.length) return;
  for (const g of state.games) {
    const div = document.createElement("article");
    div.className = `tile tile-${g.code}`;
    const h = document.createElement("h2"); h.textContent = g.title;
    const p = document.createElement("p"); p.textContent = g.blurb;
    const s = document.createElement("small"); s.textContent = "Ember Forge Studio, built on Kiln";
    const b = document.createElement("button"); b.type = "button"; b.textContent = `Play ${g.title}`;
    b.addEventListener("click", () => play(g));
    div.append(h, p, s, b);
    host.append(div);
  }
}

async function play(g) {
  const launch = await post("/api/launch", { playerId: $("player").value, gameCode: g.code });
  if (!launch.launchUrl) return alertLine(launch.detail);
  $("tiles").hidden = true;
  $("lobby-home").hidden = false;
  const game = $("game");
  game.title = g.title;
  game.hidden = false;
  game.src = launch.launchUrl;
}

function home() {
  $("game").hidden = true; $("game").src = "about:blank"; $("tiles").hidden = false; $("lobby-home").hidden = true;
}

async function openHistory(round) {
  const t = await post("/api/history-token", { playerId: $("player").value });
  const frag = new URLSearchParams({ token: t.token });
  if (round) frag.set("round", round);
  $("history").src = `${t.catwalkUrl}#${frag}`;
  $("drawer").hidden = false;
}

function alertLine(msg) { const n = $("notice"); n.textContent = msg || "Launch failed."; n.hidden = false; setTimeout(() => (n.hidden = true), 6000); }

window.addEventListener("message", (ev) => {
  if (!state || !state.gameOrigins.includes(ev.origin) || ev.origin !== new URL($("game").src || "http://x").origin) return;
  if (ev.data?.type === "game:open-history") openHistory(ev.data.roundId ? `${ev.data.studio ?? "ember-forge"}/${ev.data.roundId}` : null);
});
$("lobby-home").addEventListener("click", home);
$("open-history").addEventListener("click", () => openHistory(null));
$("close-history").addEventListener("click", () => { $("drawer").hidden = true; $("history").src = "about:blank"; });
$("player").addEventListener("change", () => { home(); $("drawer").hidden = true; refresh(); });
$("wallet-down").addEventListener("change", (e) => post("/api/faults", { walletDown: e.target.checked }));
$("credit-down").addEventListener("change", (e) => post("/api/faults", { creditDown: e.target.checked }));
$("skew").addEventListener("click", () => post("/api/faults", { skewNextSettlementMinor: 100 }).then(() => ($("skew").textContent = "The next round will be paid 1.00 too much")));
refresh();
setInterval(refresh, 3000);
