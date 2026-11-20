// Pixi compiles shaders without eval when this module is loaded, so pages keep a strict CSP (no unsafe-eval).
import "pixi.js/unsafe-eval";
// The Pixi stage: a fixed design resolution scaled to fit its element, WebGL preferred (it is what
// every target device has; WebGPU support on low-end phones is still patchy).
import { Application, Assets, Container, Sprite, type Spritesheet, type Texture } from "pixi.js";
import type { Theme } from "./types.ts";
import { Tweens } from "./tweens.ts";

export const DESIGN = { width: 1280, height: 760 };

export interface Stage {
  app: Application;
  root: Container; // scaled to fit; children use DESIGN coordinates
  tweens: Tweens;
  texture(name: string): Texture;
}

export async function createStage(el: HTMLElement, theme: Theme, assetBase: string): Promise<Stage> {
  const app = new Application();
  await app.init({
    background: theme.background, resizeTo: el, antialias: true, autoDensity: true,
    resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2), preference: "webgl",
  });
  app.canvas.setAttribute("aria-hidden", "true"); // the HUD and live region describe the game for assistive tech
  el.appendChild(app.canvas);
  // Pixi would decode images in a blob: worker; a strict CSP forbids blob workers, so decode on the main thread.
  Assets.setPreferences({ preferWorkers: false });
  const sheet = (await Assets.load(`${assetBase}atlas.json`)) as Spritesheet;
  const bg = (await Assets.load(`${assetBase}background.png`)) as Texture;

  const background = new Sprite(bg);
  app.stage.addChild(background);
  const root = new Container();
  app.stage.addChild(root);
  const tweens = new Tweens();
  app.ticker.add(() => tweens.update());

  const fit = () => {
    const w = app.renderer.width / app.renderer.resolution, h = app.renderer.height / app.renderer.resolution;
    const s = Math.min(w / DESIGN.width, h / DESIGN.height);
    root.scale.set(s);
    root.position.set((w - DESIGN.width * s) / 2, (h - DESIGN.height * s) / 2);
    const bs = Math.max(w / bg.width, h / bg.height); // background covers the whole canvas
    background.scale.set(bs);
    background.position.set((w - bg.width * bs) / 2, (h - bg.height * bs) / 2);
  };
  app.renderer.on("resize", fit);
  fit();
  return {
    app, root, tweens,
    texture(name) {
      const t = sheet.textures[name];
      if (!t) throw new Error(`no sprite "${name}" in the atlas`);
      return t;
    },
  };
}
