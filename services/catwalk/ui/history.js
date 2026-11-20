// Catwalk history page. The history token arrives in the URL fragment from the operator's lobby,
// is kept in memory only, and is removed from the address bar straight away.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("token");
const deepLink = params.get("round");
history.replaceState(null, "", location.pathname);

const GAME_TITLES = { "ember-anvil": "Ember Anvil", "rps-land": "Land of Rock Paper Scissors" };
let rangeDays = 1, nextCursor = null, current = null, replayOrigin = null;

const fmt = (minor, cur) => new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "EUR" }).format(minor / 100);
const signed = (minor, cur) => (minor > 0 ? "+" : minor < 0 ? "−" : "") + fmt(Math.abs(minor), cur);
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
const WALLET = {
  confirmed: ["Paid", "The wallet paid exactly this result."],
  mismatch: ["Check needed", "The wallet paid a different amount from the game's result. This has been reported to the casino."],
  pending: ["Waiting", "The wallet hasn't confirmed this round yet. This normally takes a few seconds."],
};

function showError(msg) {
  const e = $("error");
  e.textContent = msg;
  e.hidden = false;
  clearTimeout(showError.t);
  showError.t = setTimeout(() => (e.hidden = true), 6000);
}

async function api(path) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("Your history link has expired. Open your history again from the casino lobby.");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Your history is temporarily unavailable.");
  return res.json();
}

function sinceIso() {
  const d = new Date();
  if (rangeDays === 1) d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - rangeDays);
  return d.toISOString();
}

async function loadSummary() {
  const s = await api(`/v1/me/summary?from=${encodeURIComponent(sinceIso())}`);
  const cur = s.currency || "EUR";
  $("summary").innerHTML = "";
  const dl = document.createElement("dl");
  for (const [label, value, cls] of [
    ["Rounds", String(s.rounds)],
    ["Staked", fmt(s.stakeMinor, cur)],
    ["Won", fmt(s.winMinor, cur)],
    ["Net", signed(s.netMinor, cur), s.netMinor > 0 ? "pos" : "neg"],
    ["Biggest win", fmt(s.biggestWinMinor, cur)],
  ]) {
    const div = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value; if (cls) dd.className = cls;
    div.append(dt, dd); dl.append(div);
  }
  $("summary").append(dl);
}

function rowFor(r) {
  const tr = document.createElement("tr");
  tr.dataset.key = `${r.studioCode}/${r.roundId}`;
  const net = r.winMinor - r.stakeMinor;
  const cells = [
    [new Date(r.playedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + (rangeDays > 1 ? `, ${new Date(r.playedAt).toLocaleDateString()}` : ""), ""],
    [GAME_TITLES[r.gameCode] || r.gameCode, ""],
    [fmt(r.stakeMinor, r.currency), "num"],
    [fmt(r.winMinor, r.currency), "num"],
    [signed(net, r.currency), `num ${net > 0 ? "pos" : "neg"}`],
    [WALLET[r.walletCheck][0], `badge ${r.walletCheck}`],
  ];
  cells.forEach(([text, cls], i) => {
    const td = document.createElement("td");
    const el = document.createElement(i === 0 ? "button" : "span");
    if (i === 0) { el.type = "button"; el.setAttribute("aria-label", `Open round played ${when(r.playedAt)}, ${WALLET[r.walletCheck][0]}`); }
    el.textContent = text;
    if (cls) td.className = cls;
    td.append(el);
    tr.append(td);
  });
  tr.addEventListener("click", () => openRound(r.studioCode, r.roundId));
  return tr;
}

async function loadRounds(append = false) {
  const q = new URLSearchParams({ limit: "20", from: sinceIso() });
  if (append && nextCursor) q.set("cursor", nextCursor);
  const page = await api(`/v1/me/rounds?${q}`);
  if (!append) $("rows").innerHTML = "";
  page.rounds.forEach((r) => $("rows").append(rowFor(r)));
  nextCursor = page.next;
  $("more").hidden = !nextCursor;
  $("empty").hidden = $("rows").children.length > 0;
  markCurrent();
}

function markCurrent() {
  for (const tr of $("rows").children) tr.setAttribute("aria-current", String(current && tr.dataset.key === `${current.studioCode}/${current.roundId}`));
}

async function openRound(studio, roundId) {
  const r = await api(`/v1/me/rounds/${studio}/${roundId}`);
  current = r;
  markCurrent();
  $("placeholder").hidden = true;
  $("round").hidden = false;
  $("detail").classList.add("open");
  $("round-title").textContent = `${GAME_TITLES[r.gameCode] || r.gameCode}, ${when(r.playedAt)}`;
  const seal = $("seal");
  seal.className = "seal";
  seal.textContent = "Checking the result with the game's rules...";

  const facts = [["Stake", fmt(r.stakeMinor, r.currency)], ["Win", fmt(r.winMinor, r.currency)], ["Balance after", fmt(r.balanceAfterMinor, r.currency)],
    ["Net", signed(r.winMinor - r.stakeMinor, r.currency)], ["Wallet", WALLET[r.walletCheck][1]]];
  if (r.walletCheck === "mismatch") facts.push(["Wallet paid", fmt(r.walletWinMinor ?? 0, r.currency)]);
  const factsEl = $("facts");
  factsEl.innerHTML = "";
  for (const [k, v] of facts) {
    const div = document.createElement("div");
    if (k === "Wallet") div.className = "wide";
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    div.append(dt, dd);
    factsEl.append(div);
  }

  const wins = $("wins");
  wins.innerHTML = "";
  const stepName = (k) => (k ? `Free respin ${k}, ` : "");
  const multOf = (k) => r.outcome.steps?.find((s) => s.step === k)?.winMultiplier ?? 1;
  const items = r.outcome.lineWins
    .map((w) => `${stepName(w.step ?? 0)}line ${w.line}: ${w.count} × ${w.symbol}${multOf(w.step ?? 0) > 1 ? ` (x${multOf(w.step ?? 0)})` : ""} pays ${fmt(w.win.amountMinor, r.currency)}`)
    .map((t) => t[0].toUpperCase() + t.slice(1));
  if ((r.outcome.steps?.length ?? 1) > 1) items.unshift(`${r.outcome.steps.length} spins in this round: the paid spin and ${r.outcome.steps.length - 1} free respin${r.outcome.steps.length > 2 ? "s" : ""}.`);
  if (r.outcome.scatter.win.amountMinor > 0) items.push(`${r.outcome.scatter.count} crucibles anywhere pay ${fmt(r.outcome.scatter.win.amountMinor, r.currency)}`);
  if (items.length === 0) items.push("No winning lines this round.");
  for (const t of items) { const li = document.createElement("li"); li.textContent = t; wins.append(li); }

  fill($("tech"), [["Round id", r.roundId], ["Game build", `${r.gameCode} ${r.buildVersion}`], ["Reel stops", (r.outcome.steps ?? [r.outcome]).map((s) => s.stops.join(", ")).join(" | ")],
    ["Math model", r.mathModelSha256], ["Jurisdiction", r.jurisdictionCode], ["Signed by", `${r.studioCode} (key ${r.signatureKeyId}), verified`]]);

  const frame = $("replay");
  if (r.replayUrl) {
    replayOrigin = new URL(r.replayUrl).origin;
    frame.onload = () => frame.contentWindow.postMessage({ type: "catwalk:replay", round: r }, replayOrigin);
    frame.src = r.replayUrl;
  } else {
    seal.textContent = "This game has no replay available; the record above is the signed result.";
  }
  $("detail").focus({ preventScroll: true });
}

function fill(dl, pairs) {
  dl.innerHTML = "";
  for (const [k, v] of pairs) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
}

// The replay renderer re-computes the win from the reel stops with the game's certified rules.
window.addEventListener("message", (ev) => {
  if (ev.origin !== replayOrigin || ev.source !== $("replay").contentWindow) return;
  const m = ev.data;
  if (m?.type !== "replay:result" || !current || m.roundId !== current.roundId) return;
  const seal = $("seal");
  if (m.matches) {
    seal.className = "seal ok";
    seal.textContent = `Checked: ${m.gameTitle} ${m.buildVersion} re-calculated this round from its reel stops and got the same win, ${fmt(m.recomputedWinMinor, current.currency)}.`;
  } else {
    seal.className = "seal bad";
    seal.textContent = `The game's rules give ${fmt(m.recomputedWinMinor, current.currency)} for these reel stops, not the recorded win. This round has been flagged for review.`;
  }
});

$("close").addEventListener("click", () => { $("detail").classList.remove("open"); current = null; markCurrent(); });
$("more").addEventListener("click", () => loadRounds(true).catch((e) => showError(e.message)));
for (const b of document.querySelectorAll(".range button")) {
  b.addEventListener("click", () => {
    rangeDays = Number(b.dataset.range);
    for (const o of document.querySelectorAll(".range button")) o.setAttribute("aria-pressed", String(o === b));
    refresh();
  });
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadRounds()]);
  } catch (e) {
    showError(e.message);
  }
}

if (!token) {
  $("who").textContent = "Open your history from the casino lobby to see your rounds.";
} else {
  refresh().then(() => {
    if (deepLink) {
      const [studio, id] = deepLink.split("/");
      openRound(studio, id).catch((e) => showError(e.message));
    }
  });
  setInterval(() => { if (!document.hidden) loadSummary().catch(() => {}); }, 15000);
}
