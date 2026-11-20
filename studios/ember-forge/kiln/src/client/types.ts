// What a game gives Kiln's client: its math (for the paytable and for replays), its theme, its
// sprite atlas and, if it has features, a presenter that animates them.
import type { Container, Texture } from "pixi.js";
import type { GameMath, StepResult, Transform } from "../math/types.ts";
import type { ReelSet } from "./reels.ts";
import type { Tweens } from "./tweens.ts";

export interface Theme {
  background: string; // canvas clear colour
  frame: number; // reel frame colour
  frameEdge: number;
  reelBg: number;
  winLineColours: number[];
  displayFont: string; // CSS font-family, loaded by the game's CSS
  textColour: number;
  winTextColour: number;
  winTextStroke: number;
}

export interface GameDefinition {
  math: GameMath;
  title: string;
  studioCode: string;
  theme: Theme;
  /** Atlas frame name per symbol code (usually the same name). */
  symbolFrames?: Record<string, string>;
  /** Short lines for the rules dialog. */
  rules: string[];
  symbolNames: Record<string, string>;
  presenter?: FeaturePresenter;
}

export interface PresentContext {
  stage: Container;
  reels: ReelSet;
  tweens: Tweens;
  texture(symbol: string): Texture;
  fast: boolean; // replays and reduced motion: shorter, simpler animations
}

/** Animates what a game's feature rules did on one step (wraps, cuts, smashes...). */
export interface FeaturePresenter {
  present(step: StepResult, ctx: PresentContext): Promise<void>;
  describe(t: Transform): string;
}
