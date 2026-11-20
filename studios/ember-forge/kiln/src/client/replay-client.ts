// startReplay: the replay renderer every Kiln build ships (manifest replayEntrypoint). Catwalk embeds
// it and sends a recorded round. It re-plays the round from the recorded stops with THIS build's
// certified math, compares with the recorded result, reports back, then animates what it computed.
import { createStage } from "./stage.ts";
import { ReelSet } from "./reels.ts";
import type { GameDefinition, PresentContext } from "./types.ts";
import type { RoundResult } from "../math/types.ts";

declare const __KILN_BUILD__: { mathModelSha256: string; buildVersion: string; parentOrigins: string[] };

interface RecordedRound {
  roundId: string; stakeMinor: number; winMinor: number; currency: string; mathModelSha256: string;
  outcome: { stops: number[]; grid: string[][]; steps?: { stops: number[]; grid: string[][] }[] };
}

export async function startReplay(def: GameDefinition) {
  const cfg = def.math.config;
  // Listen before anything async: Catwalk sends the round as soon as the frame loads, which can be
  // before Pixi and the atlas are ready. Rounds that arrive early wait for the stage.
  let handle: ((ev: MessageEvent) => void) | null = null;
  const early: MessageEvent[] = [];
  window.addEventListener("message", (ev) => (handle ? handle(ev) : early.push(ev)));
  document.title = `${def.title} replay`;
  document.body.innerHTML = `<main class="kiln kiln-replay"><div class="kiln-canvas" id="kiln-canvas"></div>
    <p class="kiln-caption" id="kiln-caption">Waiting for a round...</p>
    <button type="button" class="kiln-again" id="kiln-again" hidden>Play again</button></main>`;
  await document.fonts.load(`32px ${def.theme.displayFont}`).catch(() => {});
  const stage = await createStage(document.getElementById("kiln-canvas")!, def.theme, "./");
  const tex = (s: string) => stage.texture(def.symbolFrames?.[s] ?? s);
  const blank = Array.from({ length: cfg.reels }, (_, r) => Array.from({ length: cfg.rows }, (_, i) => cfg.strips[r]![i]!));
  const reels = new ReelSet(cfg, def.theme, tex, stage.tweens, blank);
  stage.root.addChild(reels);
  const ctx: PresentContext = { stage: stage.root, reels, tweens: stage.tweens, texture: tex, fast: true };
  const caption = (t: string) => { document.getElementById("kiln-caption")!.textContent = t; };
  let last: RoundResult | null = null;

  async function animate(r: RoundResult) {
    for (const s of r.steps) {
      caption(s.step === 0 ? `Paid spin: reel stops ${s.stops.join(", ")}` : `Free respin ${s.step}: reel stops ${s.stops.join(", ")}`);
      await reels.setHeld(s.held, def.theme.displayFont);
      reels.clearLines();
      reels.show(s.landed);
      await stage.tweens.wait(500);
      if (s.transforms.length && def.presenter) await def.presenter.present(s, ctx);
      reels.show(s.final);
      if (s.lineWins.length) await reels.showWins(s.lineWins);
      await stage.tweens.wait(r.steps.length > 1 ? 900 : 200);
    }
    await reels.setHeld([], def.theme.displayFont);
    const lines = r.steps.reduce((n, s) => n + s.lineWins.length, 0);
    caption(`${r.steps.length > 1 ? `${r.steps.length} spins, ` : ""}${lines} winning line${lines === 1 ? "" : "s"}. Re-calculated by ${def.title} ${__KILN_BUILD__.buildVersion}.`);
    (document.getElementById("kiln-again") as HTMLButtonElement).hidden = false;
  }

  document.getElementById("kiln-again")!.addEventListener("click", () => { if (last) { (document.getElementById("kiln-again") as HTMLButtonElement).hidden = true; animate(last); } });

  handle = (ev: MessageEvent) => {
    if (!__KILN_BUILD__.parentOrigins.includes(ev.origin) || ev.source !== window.parent) return;
    const round: RecordedRound | undefined = ev.data?.type === "catwalk:replay" ? ev.data.round : undefined;
    if (!round?.outcome?.stops) return;
    const reply = (matches: boolean, recomputedWinMinor: number) =>
      window.parent.postMessage({ type: "replay:result", roundId: round.roundId, matches, recomputedWinMinor, gameTitle: def.title, buildVersion: __KILN_BUILD__.buildVersion }, ev.origin);
    if (round.mathModelSha256 !== __KILN_BUILD__.mathModelSha256) {
      reels.show(round.outcome.grid);
      caption("This round was played on a different version of the game rules, so this renderer can't re-check it.");
      return reply(false, -1);
    }
    const stops = round.outcome.steps?.map((s) => s.stops) ?? [round.outcome.stops];
    const lineBet = round.stakeMinor / cfg.lines.length;
    let r: RoundResult;
    try {
      if (!Number.isInteger(lineBet)) throw new Error("stake is not a whole line bet");
      r = def.math.playRound((k) => { const s = stops[k]; if (!s) throw new Error("recorded round has fewer spins than the rules give"); return s; }, lineBet);
    } catch (e) {
      caption(`These reel stops don't make a valid round under this build's rules (${(e as Error).message}).`);
      return reply(false, -1);
    }
    const sameShape = r.steps.length === stops.length && r.steps.every((s, k) => JSON.stringify(s.final) === JSON.stringify(round.outcome.steps?.[k]?.grid ?? round.outcome.grid));
    reply(sameShape && r.totalWinMinor === round.winMinor, r.totalWinMinor);
    last = r;
    animate(r);
  };
  early.splice(0).forEach((ev) => handle!(ev));
}
