// How Land of Rock Paper Scissors shows its rules happening: the paper flies onto the rock and
// wraps it, the scissors snip and the paper splits into two torn wilds, the rock lunges at the
// scissors and the multiplier climbs. All tween.js on Pixi sprites; shorter in replays.
import { Sprite } from "pixi.js";
import { CELL, Easing, type FeaturePresenter, type PresentContext } from "@ember-forge/kiln/client";
import type { StepResult, Transform } from "@ember-forge/kiln/math";

function flyer(ctx: PresentContext, symbol: string, reel: number, row: number) {
  const s = new Sprite(ctx.texture(symbol));
  s.anchor.set(0.5);
  s.scale.set((CELL * 0.86) / Math.max(s.texture.width, s.texture.height));
  const p = ctx.reels.cellCenter(reel, row);
  s.position.set(p.x, p.y);
  ctx.reels.fxLayer.addChild(s);
  return s;
}

function setCell(ctx: PresentContext, reel: number, row: number, symbol: string) {
  const s = ctx.reels.cellSprite(reel, row);
  s.texture = ctx.texture(symbol);
  s.scale.set((CELL * 0.86) / Math.max(s.texture.width, s.texture.height));
  return s;
}

async function wrap(t: Transform, ctx: PresentContext, k: number) {
  const [pr, pw] = t.by[0]!, [rr, rw] = t.cells[0]!;
  const sheet = flyer(ctx, "paper", pr, pw);
  const to = ctx.reels.cellCenter(rr, rw);
  await ctx.tweens.to(sheet, { x: to.x, y: to.y, rotation: 0.6 } as Partial<Sprite>, 420 * k, Easing.Cubic.InOut);
  await ctx.tweens.to(sheet.scale, { x: sheet.scale.x * 0.4, y: sheet.scale.y * 0.4 }, 160 * k, Easing.Quadratic.In);
  sheet.destroy();
  const cell = setCell(ctx, rr, rw, "wrapped");
  const end = cell.scale.x;
  cell.scale.set(end * 0.5);
  await ctx.tweens.to(cell.scale, { x: end, y: end }, 300 * k, Easing.Back.Out);
}

async function cut(t: Transform, ctx: PresentContext, k: number) {
  const [sr, sw] = t.by[0]!;
  const blade = ctx.reels.cellSprite(sr, sw);
  for (let i = 0; i < 2; i++) {
    await ctx.tweens.to(blade, { rotation: -0.35 } as Partial<Sprite>, 90 * k, Easing.Quadratic.Out);
    await ctx.tweens.to(blade, { rotation: 0 } as Partial<Sprite>, 90 * k, Easing.Quadratic.In);
  }
  const [pr, pw] = t.cells[0]!;
  const halves = t.cells.map(([r, w]) => {
    const h = flyer(ctx, "torn", pr, pw);
    const to = ctx.reels.cellCenter(r, w);
    return ctx.tweens.to(h, { x: to.x, y: to.y } as Partial<Sprite>, 360 * k, Easing.Back.Out).then(() => { h.destroy(); setCell(ctx, r, w, "torn"); });
  });
  await Promise.all(halves);
}

async function smash(t: Transform, ctx: PresentContext, k: number) {
  const [rr, rw] = t.by[0]!, [sr, sw] = t.cells[0]!;
  const rock = ctx.reels.cellSprite(rr, rw), blade = ctx.reels.cellSprite(sr, sw);
  const home = { x: rock.x, y: rock.y };
  const dx = (sr - rr) * CELL * 0.35, dy = (sw - rw) * CELL * 0.35;
  await ctx.tweens.to(rock, { x: home.x + dx, y: home.y + dy } as Partial<Sprite>, 140 * k, Easing.Quadratic.In);
  const bs = blade.scale.x;
  await Promise.all([
    ctx.tweens.to(rock, { x: home.x, y: home.y } as Partial<Sprite>, 220 * k, Easing.Back.Out),
    ctx.tweens.to(blade.scale, { x: bs * 0.55, y: bs * 1.25 }, 90 * k).then(() => ctx.tweens.to(blade.scale, { x: bs, y: bs }, 240 * k, Easing.Elastic.Out)),
    shake(ctx, k),
  ]);
}

async function shake(ctx: PresentContext, k: number) {
  const x = ctx.reels.x;
  for (const d of [9, -7, 5, -3, 0]) await ctx.tweens.to(ctx.reels, { x: x + d } as Partial<typeof ctx.reels>, 40 * k);
}

export const rpsPresenter: FeaturePresenter = {
  async present(step: StepResult, ctx: PresentContext) {
    const k = ctx.fast ? 0.5 : 1;
    for (const kind of ["wrap", "cut", "smash"]) {
      for (const t of step.transforms.filter((x) => x.kind === kind)) {
        if (kind === "wrap") await wrap(t, ctx, k);
        else if (kind === "cut") await cut(t, ctx, k);
        else await smash(t, ctx, k);
      }
    }
  },
  describe(t: Transform) {
    if (t.kind === "wrap") return "Paper wraps rock: a sticky wild for 1 free respin.";
    if (t.kind === "cut") return "Scissors cut paper: two sticky wilds for 2 free respins.";
    return "Rock smashes scissors: the win multiplier goes up.";
  },
};
