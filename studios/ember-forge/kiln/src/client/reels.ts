// The reel set: masked columns of sprites that spin by scrolling a symbol sequence (classic strip
// technique: only rows + 1 sprites per reel exist, their textures follow the scroll position),
// a layer for held wilds that stay put while the reels spin underneath, and a layer for win lines.
import { BlurFilter, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { HeldCell, LineGameConfig, LineResult } from "../math/types.ts";
import { DESIGN } from "./stage.ts";
import { Easing, type Tweens } from "./tweens.ts";
import type { Theme } from "./types.ts";

export const CELL = 172, GAP = 14, PAD = 20;

class Reel extends Container {
  readonly sprites: Sprite[] = [];
  private seq: string[] = [];
  private pos = 1;
  private readonly blur = new BlurFilter();
  private readonly rows: number;
  private readonly tex: (s: string) => Texture;
  constructor(rows: number, tex: (s: string) => Texture, initial: string[]) {
    super();
    this.rows = rows;
    this.tex = tex;
    this.blur.strengthX = 0;
    this.blur.strengthY = 7;
    for (let i = 0; i <= rows; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      this.addChild(s);
      this.sprites.push(s);
    }
    this.show(initial);
  }

  show(column: string[]) {
    this.seq = ["", ...column, column[0]!];
    this.pos = 1;
    this.layout();
  }

  private layout() {
    const base = Math.floor(this.pos), frac = this.pos - base;
    this.sprites.forEach((s, i) => {
      const sym = this.seq[base + i];
      if (sym) {
        s.texture = this.tex(sym);
        s.visible = true;
        const k = (CELL * 0.86) / Math.max(s.texture.width, s.texture.height);
        s.scale.set(k);
      } else s.visible = false;
      s.position.set(CELL / 2, (i - frac) * CELL + CELL / 2);
    });
  }

  /** Spin to `final`. `filler` symbols scroll past first; longer for reels further right. */
  async spin(final: string[], filler: string[], ms: number, tweens: Tweens) {
    if (tweens.reducedMotion) { this.show(final); return; }
    const current = this.seq.slice(1, this.rows + 1);
    this.seq = ["", ...final, ...filler, ...current];
    this.pos = 1 + final.length + filler.length;
    this.filters = [this.blur];
    const state = { p: this.pos };
    await tweens.to(state, { p: 1 }, ms, Easing.Cubic.InOut, () => { this.pos = state.p; this.layout(); });
    this.filters = [];
    this.show(final);
    const y = this.y;
    await tweens.to(this as Container, { y: y + 12 }, 70, Easing.Quadratic.Out);
    await tweens.to(this as Container, { y }, 160, Easing.Back.Out);
  }

  sprite(row: number) { return this.sprites[row]!; }
}

export class ReelSet extends Container {
  readonly reels: Reel[] = [];
  readonly heldLayer = new Container();
  readonly linesLayer = new Container();
  readonly fxLayer = new Container();
  readonly originX: number;
  readonly originY: number;
  private readonly cfg: LineGameConfig;
  private readonly theme: Theme;
  private readonly tex: (s: string) => Texture;
  private readonly tweens: Tweens;

  constructor(cfg: LineGameConfig, theme: Theme, tex: (s: string) => Texture, tweens: Tweens, initial: string[][]) {
    super();
    this.cfg = cfg; this.theme = theme; this.tex = tex; this.tweens = tweens;
    const w = cfg.reels * CELL + (cfg.reels - 1) * GAP, h = cfg.rows * CELL;
    this.originX = (DESIGN.width - w) / 2;
    this.originY = 84;
    const frame = new Graphics()
      .roundRect(this.originX - PAD, this.originY - PAD, w + PAD * 2, h + PAD * 2, 26).fill(theme.frame)
      .roundRect(this.originX - PAD, this.originY - PAD, w + PAD * 2, h + PAD * 2, 26).stroke({ width: 4, color: theme.frameEdge });
    this.addChild(frame);
    for (let r = 0; r < cfg.reels; r++) {
      const x = this.originX + r * (CELL + GAP);
      const bg = new Graphics().roundRect(x, this.originY, CELL, h, 14).fill(theme.reelBg);
      const mask = new Graphics().roundRect(x, this.originY, CELL, h, 14).fill(0xffffff);
      const reel = new Reel(cfg.rows, tex, initial[r]!);
      reel.position.set(x, this.originY);
      reel.mask = mask;
      this.addChild(bg, mask, reel);
      this.reels.push(reel);
    }
    this.addChild(this.heldLayer, this.linesLayer, this.fxLayer);
  }

  cellCenter(reel: number, row: number) {
    return { x: this.originX + reel * (CELL + GAP) + CELL / 2, y: this.originY + row * CELL + CELL / 2 };
  }
  cellSprite(reel: number, row: number) { return this.reels[reel]!.sprite(row); }

  show(grid: string[][]) { grid.forEach((col, r) => this.reels[r]!.show(col)); }

  /** Spins every reel to `grid`; reels with a held wild still spin underneath it. */
  async spin(grid: string[][]) {
    this.clearLines();
    const symbols = this.cfg.symbols.filter((s) => !(this.cfg.extraWilds ?? []).includes(s));
    const filler = (n: number) => Array.from({ length: n }, () => symbols[Math.floor(Math.random() * symbols.length)]!);
    await Promise.all(grid.map((col, r) => this.reels[r]!.spin(col, filler(9 + r * 3), 620 + r * 170, this.tweens)));
  }

  /** Draws held wilds above the reels, each with a badge showing the spins it stays for. */
  async setHeld(held: HeldCell[], fontFamily: string) {
    const keep = new Set(held.map((h) => `${h.reel}:${h.row}`));
    for (const c of [...this.heldLayer.children]) if (!keep.has(c.label)) c.destroy({ children: true });
    for (const h of held) {
      const key = `${h.reel}:${h.row}`;
      let box = this.heldLayer.children.find((c) => c.label === key) as Container | undefined;
      const fresh = !box;
      if (!box) {
        box = new Container();
        box.label = key;
        const { x, y } = this.cellCenter(h.reel, h.row);
        box.position.set(x, y);
        const glow = new Graphics().roundRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8, 16).fill({ color: this.theme.winTextColour, alpha: 0.22 })
          .roundRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8, 16).stroke({ width: 5, color: this.theme.winTextColour });
        const s = new Sprite(this.tex(h.symbol));
        s.anchor.set(0.5);
        s.scale.set((CELL * 0.86) / Math.max(s.texture.width, s.texture.height));
        const badge = new Graphics().circle(CELL / 2 - 26, -CELL / 2 + 26, 20).fill(this.theme.frameEdge).circle(CELL / 2 - 26, -CELL / 2 + 26, 20).stroke({ width: 3, color: 0xffffff });
        const n = new Text({ text: "", style: { fontFamily, fontSize: 24, fill: 0xffffff } });
        n.anchor.set(0.5);
        n.position.set(CELL / 2 - 26, -CELL / 2 + 26);
        n.label = "count";
        box.addChild(glow, s, badge, n);
        this.heldLayer.addChild(box);
      }
      (box.getChildByLabel("count") as Text).text = String(h.spinsLeft);
      if (fresh) { box.scale.set(0.4); await this.tweens.to(box.scale, { x: 1, y: 1 }, 260, Easing.Back.Out); }
    }
  }

  clearLines() {
    this.linesLayer.removeChildren().forEach((c) => c.destroy());
  }

  /** Win lines with a soft glow, and a pulse on every winning cell. */
  async showWins(wins: LineResult[]) {
    this.clearLines();
    const pulses: Promise<void>[] = [];
    wins.forEach((w, i) => {
      const colour = this.theme.winLineColours[i % this.theme.winLineColours.length]!;
      const pts = this.cfg.lines[w.line - 1]!.map((row, reel) => this.cellCenter(reel, row));
      const g = new Graphics();
      for (const [width, alpha] of [[16, 0.25], [7, 1]] as const) {
        g.moveTo(pts[0]!.x - CELL * 0.45, pts[0]!.y);
        for (const p of pts) g.lineTo(p.x, p.y);
        g.lineTo(pts.at(-1)!.x + CELL * 0.45, pts.at(-1)!.y);
        g.stroke({ width, color: colour, alpha, cap: "round", join: "round" });
      }
      this.linesLayer.addChild(g);
      for (const [reel, row] of w.positions) pulses.push(this.tweens.pulse(this.cellSprite(reel, row), 0.14, 240, 2));
    });
    await Promise.all(pulses);
  }
}
