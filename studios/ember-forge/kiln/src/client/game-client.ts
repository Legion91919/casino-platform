// startGame: the whole game client for any Kiln game. The game supplies a GameDefinition and art.
import { Container, Text } from "pixi.js";
import { createStage, DESIGN } from "./stage.ts";
import { ReelSet } from "./reels.ts";
import { buildHud } from "./hud.ts";
import { GameApi, type SpinResponse, type WireStep } from "./net.ts";
import { Easing } from "./tweens.ts";
import type { GameDefinition, PresentContext } from "./types.ts";
import type { LineResult, StepResult } from "../math/types.ts";

export async function startGame(def: GameDefinition) {
  const cfg = def.math.config;
  const hash = new URLSearchParams(location.hash.slice(1));
  const launchToken = hash.get("token"), lobbyOrigin = hash.get("lobby");
  history.replaceState(null, "", location.pathname + location.search);

  const hud = buildHud(def);
  await document.fonts.load(`32px ${def.theme.displayFont}`).catch(() => {});
  const stage = await createStage(hud.canvasHost, def.theme, "./");
  const frame = (s: string) => def.symbolFrames?.[s] ?? s;
  const tex = (s: string) => stage.texture(frame(s));
  const randomGrid = () => Array.from({ length: cfg.reels }, (_, r) => Array.from({ length: cfg.rows }, (_, i) => cfg.strips[r]![(i * 7 + r * 3) % cfg.strips[r]!.length]!));
  const reels = new ReelSet(cfg, def.theme, tex, stage.tweens, randomGrid());
  stage.root.addChild(reels);

  const banner = new Container();
  const winText = new Text({ text: "", style: { fontFamily: def.theme.displayFont, fontSize: 96, fill: def.theme.winTextColour, stroke: { color: def.theme.winTextStroke, width: 10 }, align: "center" } });
  winText.anchor.set(0.5);
  winText.position.set(DESIGN.width / 2, reels.originY + 1.5 * 172);
  const multText = new Text({ text: "", style: { fontFamily: def.theme.displayFont, fontSize: 64, fill: 0xffffff, stroke: { color: def.theme.winTextStroke, width: 8 } } });
  multText.anchor.set(0.5);
  multText.position.set(DESIGN.width / 2, reels.originY - 2);
  banner.addChild(winText, multText);
  stage.root.addChild(banner);

  const ctx: PresentContext = { stage: stage.root, reels, tweens: stage.tweens, texture: tex, fast: stage.tweens.reducedMotion };
  const api = new GameApi();
  let balance = 0, betIndex = Math.min(2, cfg.lineBetsMinor.length - 1), busy = false, lastRound: string | null = null;
  const lineBet = () => cfg.lineBetsMinor[betIndex]!;
  const refresh = () => { hud.setBalance(balance); hud.setBet(lineBet() * cfg.lines.length); hud.setBusy(busy || !api.ready); };

  async function rollWin(minor: number, label: string) {
    if (minor <= 0) return;
    const v = { n: 0 };
    winText.alpha = 1;
    winText.scale.set(0.6);
    stage.tweens.to(winText.scale, { x: 1, y: 1 }, 300, Easing.Back.Out);
    await stage.tweens.to(v, { n: minor }, Math.min(1400, 400 + minor * 4), Easing.Quadratic.Out, () => { winText.text = `${label}${hud.fmt(Math.round(v.n))}`; });
    winText.text = `${label}${hud.fmt(minor)}`;
  }

  async function playStep(s: WireStep, r: SpinResponse, next: WireStep | undefined) {
    multText.text = "";
    await reels.setHeld(s.held, def.theme.displayFont);
    await reels.spin(s.landed ?? s.grid);
    if (s.transforms.length && def.presenter) {
      const asStep = { ...s, final: s.grid, lineWins: [], scatterCount: 0, scatterMultiplier: 0, winMinor: s.win.amountMinor } as unknown as StepResult;
      await def.presenter.present(asStep, ctx);
      hud.say(s.transforms.map((t) => def.presenter!.describe(t)).filter((x, i, a) => a.indexOf(x) === i).join(" "), "win");
    }
    reels.show(s.grid);
    if (s.winMultiplier > 1) {
      multText.text = `x${s.winMultiplier}`;
      multText.scale.set(0.3);
      await stage.tweens.to(multText.scale, { x: 1, y: 1 }, 320, Easing.Back.Out);
    }
    if (next) await reels.setHeld(next.held, def.theme.displayFont);
    const wins: LineResult[] = r.outcome.lineWins.filter((w) => (w.step ?? 0) === s.step).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, multiplier: 0, positions: w.positions }));
    if (wins.length) await Promise.all([reels.showWins(wins), rollWin(s.win.amountMinor, s.step > 0 ? "Respin " : "")]);
    if (next) await stage.tweens.wait(500);
  }

  async function spin() {
    if (busy || !api.ready) return;
    busy = true;
    winText.text = ""; multText.text = "";
    reels.clearLines();
    balance -= lineBet() * cfg.lines.length;
    refresh();
    hud.say("Spinning...");
    try {
      const r = await api.spin(lineBet(), () => hud.say("Your result is saved. Waiting for the wallet to pay it...", "warn"));
      lastRound = r.roundId;
      const steps = r.outcome.steps;
      for (const [i, s] of steps.entries()) {
        if (s.step > 0) hud.say(`Free respin ${s.step}: the wilds stay where they are.`, "win");
        await playStep(s, r, steps[i + 1]);
      }
      await reels.setHeld([], def.theme.displayFont);
      balance = r.balanceAfter.amountMinor;
      if (r.win.amountMinor > 0) {
        if (steps.length > 1) { reels.clearLines(); await rollWin(r.win.amountMinor, "Total "); }
        hud.say(`You won ${hud.fmt(r.win.amountMinor)}${steps.length > 1 ? ` over ${steps.length} spins` : ""}.`, "win");
      } else hud.say(steps.length > 1 ? "No win from the respins this time." : "No win this time.");
    } catch (e) {
      balance += lineBet() * cfg.lines.length;
      hud.say((e as Error).message, "warn");
    } finally {
      busy = false;
      refresh();
    }
  }

  hud.onSpin(spin);
  hud.onBet((d) => { betIndex = Math.max(0, Math.min(cfg.lineBetsMinor.length - 1, betIndex + d)); refresh(); });
  hud.onHistory(() => { if (lobbyOrigin) window.parent.postMessage({ type: "game:open-history", game: cfg.id, studio: def.studioCode, roundId: lastRound }, lobbyOrigin); },
    Boolean(lobbyOrigin && window.parent !== window));
  document.getElementById("kiln-rules")!.addEventListener("click", () => hud.showRules(
    Object.entries(cfg.paytable).map(([s, p]) => [def.symbolNames[s] ?? s, hud.fmt(p[0] * lineBet()), hud.fmt(p[1] * lineBet()), hud.fmt(p[2] * lineBet())])));

  refresh();
  if (!launchToken) { hud.say("Launch this game from a casino lobby to play.", "warn"); return; }
  try {
    const s = await api.open(launchToken);
    hud.currency = s.currency;
    balance = s.balance;
    hud.say(def.rules[0] ?? "Pick a bet and spin.");
  } catch (e) {
    hud.say((e as Error).message, "warn");
  }
  refresh();
}
