// tween.js wired to the Pixi ticker, with promise helpers so animations read top to bottom.
import { Easing, Group, Tween } from "@tweenjs/tween.js";

export { Easing };

export class Tweens {
  readonly group = new Group();
  readonly reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  update() {
    this.group.update();
  }

  /** Tween `target` to `to` over `ms`; resolves when done. In reduced motion it jumps straight there. */
  to<T extends object>(target: T, to: Partial<T>, ms: number, easing: (k: number) => number = Easing.Quadratic.Out, onUpdate?: () => void): Promise<void> {
    if (this.reducedMotion || ms <= 0) {
      Object.assign(target, to);
      onUpdate?.();
      return Promise.resolve();
    }
    return new Promise((done) => {
      new Tween(target, this.group).to(to as Record<string, unknown>, ms).easing(easing).onUpdate(() => onUpdate?.()).onComplete(() => done()).start();
    });
  }

  /** A yoyo pulse (e.g. a symbol in a winning line). */
  pulse(target: { scale: { x: number; y: number } }, amount = 0.12, ms = 260, repeats = 1): Promise<void> {
    if (this.reducedMotion) return Promise.resolve();
    const base = target.scale.x;
    return new Promise((done) => {
      new Tween(target.scale, this.group).to({ x: base * (1 + amount), y: base * (1 + amount) }, ms).easing(Easing.Sinusoidal.InOut)
        .yoyo(true).repeat(repeats * 2 - 1).onComplete(() => { target.scale.x = base; target.scale.y = base; done(); }).start();
    });
  }

  wait(ms: number): Promise<void> {
    return new Promise((ok) => setTimeout(ok, this.reducedMotion ? Math.min(ms, 150) : ms));
  }
}
