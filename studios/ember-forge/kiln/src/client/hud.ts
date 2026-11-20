// The control bar is plain, accessible HTML over the canvas: real buttons, keyboard focus, a live
// region that says what happened. The canvas is decoration for assistive tech (aria-hidden).
import type { GameDefinition } from "./types.ts";

export interface Hud {
  root: HTMLElement;
  canvasHost: HTMLElement;
  setBalance(minor: number): void;
  setBet(minor: number): void;
  setBusy(busy: boolean): void;
  say(text: string, tone?: "plain" | "win" | "warn"): void;
  onSpin(fn: () => void): void;
  onBet(fn: (dir: -1 | 1) => void): void;
  onHistory(fn: () => void, available: boolean): void;
  showRules(rows: [string, string, string, string][]): void;
  fmt(minor: number): string;
  currency: string;
}

export function buildHud(def: GameDefinition): Hud {
  document.title = def.title;
  const root = document.createElement("main");
  root.className = "kiln";
  root.innerHTML = `
    <div class="kiln-canvas" id="kiln-canvas"></div>
    <h1 class="kiln-title">${escape(def.title)}</h1>
    <p class="kiln-status" id="kiln-status" role="status" aria-live="polite">Loading...</p>
    <section class="kiln-hud" aria-label="Game controls">
      <p class="kiln-balance"><span>Balance</span> <strong id="kiln-balance">&ndash;</strong></p>
      <div class="kiln-bet" role="group" aria-label="Bet per spin">
        <button type="button" id="kiln-bet-down" aria-label="Lower bet">&minus;</button>
        <p><span>Bet</span> <strong id="kiln-bet">&ndash;</strong></p>
        <button type="button" id="kiln-bet-up" aria-label="Raise bet">+</button>
      </div>
      <button type="button" class="kiln-spin" id="kiln-spin" disabled>Spin</button>
      <div class="kiln-side">
        <button type="button" id="kiln-rules">Rules</button>
        <button type="button" id="kiln-history" hidden>History</button>
      </div>
    </section>
    <dialog id="kiln-rules-dialog" aria-labelledby="kiln-rules-h">
      <h2 id="kiln-rules-h">How ${escape(def.title)} pays</h2>
      <ul class="kiln-rule-list">${def.rules.map((r) => `<li>${escape(r)}</li>`).join("")}</ul>
      <table><thead><tr><th scope="col">Symbol</th><th scope="col">3</th><th scope="col">4</th><th scope="col">5</th></tr></thead><tbody id="kiln-pays"></tbody></table>
      <button type="button" id="kiln-rules-close">Close</button>
    </dialog>`;
  document.body.append(root);
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let currency = "EUR";
  const hud: Hud = {
    root,
    canvasHost: $("kiln-canvas"),
    get currency() { return currency; },
    set currency(c: string) { currency = c; },
    fmt: (minor) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100),
    setBalance(m) { $("kiln-balance").textContent = hud.fmt(m); },
    setBet(m) { $("kiln-bet").textContent = hud.fmt(m); },
    setBusy(b) {
      for (const id of ["kiln-spin", "kiln-bet-down", "kiln-bet-up"]) ($(id) as HTMLButtonElement).disabled = b;
    },
    say(text, tone = "plain") { const s = $("kiln-status"); s.textContent = text; s.dataset.tone = tone; },
    onSpin(fn) {
      $("kiln-spin").addEventListener("click", fn);
      document.addEventListener("keydown", (e) => { if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); fn(); } });
    },
    onBet(fn) {
      $("kiln-bet-down").addEventListener("click", () => fn(-1));
      $("kiln-bet-up").addEventListener("click", () => fn(1));
    },
    onHistory(fn, available) {
      const b = $("kiln-history");
      b.hidden = !available;
      b.addEventListener("click", fn);
    },
    showRules(rows) {
      $("kiln-pays").innerHTML = rows.map(([n, a, b, c]) => `<tr><th scope="row">${escape(n)}</th><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join("");
      ($("kiln-rules-dialog") as HTMLDialogElement).showModal();
    },
  };
  $("kiln-rules-close").addEventListener("click", () => ($("kiln-rules-dialog") as HTMLDialogElement).close());
  return hud;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
