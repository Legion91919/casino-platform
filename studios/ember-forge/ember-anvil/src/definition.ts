// Ember Anvil on Kiln: theme and words. No features, so no presenter: Kiln's defaults do the rest.
import type { GameDefinition } from "@ember-forge/kiln/client";
import { math, STUDIO } from "./game.ts";

export const definition: GameDefinition = {
  math,
  title: "Ember Anvil",
  studioCode: STUDIO,
  theme: {
    background: "#2e2a27", frame: 0x4a4440, frameEdge: 0x7a4e8f, reelBg: 0xd9d4cc,
    // the temper colours of heated steel, straw to blue
    winLineColours: [0xe8d49a, 0xc08a4b, 0x9c5f6e, 0x7a4e8f, 0x3d6a9e, 0xd9ad62],
    displayFont: '"Big Shoulders Display"', textColour: 0xf3eee6, winTextColour: 0xffe7a3, winTextStroke: 0x7a3b16,
  },
  rules: [
    "Ten lines pay left to right. Embers are wild. Three or more crucibles anywhere pay times your total bet.",
    "Return to player: 96.39% over the long run. Every round is random and independent.",
  ],
  symbolNames: {
    ember: "Ember (wild)", crucible: "Crucible (scatter)", anvil: "Anvil", hammer: "Hammer", tongs: "Tongs",
    ingot: "Ingot", ruby: "Ruby", jade: "Jade", rivet: "Rivet",
  },
};
