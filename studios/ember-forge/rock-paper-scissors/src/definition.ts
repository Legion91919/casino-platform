// Land of Rock Paper Scissors on Kiln: theme, words and the feature presenter.
import type { GameDefinition } from "@ember-forge/kiln/client";
import { math, STUDIO } from "./game.ts";
import { rpsPresenter } from "./presenter.ts";

export const definition: GameDefinition = {
  math,
  title: "Land of Rock Paper Scissors",
  studioCode: STUDIO,
  theme: {
    background: "#f2e6d0", frame: 0xc9a27a, frameEdge: 0x2b2a33, reelBg: 0xf7f3e8,
    winLineColours: [0xe4572e, 0x17bebb, 0xffc914, 0x6c63c7, 0x2b2a33],
    displayFont: '"Lilita One"', textColour: 0x2b2a33, winTextColour: 0xffc914, winTextStroke: 0x2b2a33,
  },
  rules: [
    "Paper wraps rock, scissors cut paper, rock smashes scissors. Watch for them landing next to each other.",
    "Paper next to a rock wraps it: the rock becomes a sticky wild for 1 free respin.",
    "Scissors next to a paper cut it in two: two sticky wilds for 2 free respins.",
    "Each rock next to scissors adds +1 to that spin's win multiplier, up to x5.",
    "\"Next to\" means left, right, above or below. Ten lines pay left to right; cranes are wild. Return to player: 95.65%.",
  ],
  symbolNames: {
    crane: "Paper crane (wild)", rock: "Rock", paper: "Paper", scissors: "Scissors",
    sun: "Sun", moon: "Moon", star: "Star", cloud: "Cloud", wrapped: "Wrapped rock (wild)", torn: "Torn paper (wild)",
  },
  presenter: rpsPresenter,
};
