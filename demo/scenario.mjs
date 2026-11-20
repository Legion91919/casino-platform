// Slot floor walkthrough for the README. Run: cd demo && npm install && node record.mjs ..
// Kestrel's (invented) lobby offers two Kiln games. The player plays Land of Rock Paper Scissors until
// a rule fires (wrap, cut or smash), then opens that exact round in Catwalk, where the game's own
// renderer replays it from the recorded reel stops and confirms the win.
const FEATURE = /wraps|cut paper|smashes|respin/i;

async function spinUntilFeature(game, page, shot, maxSpins = 60) {
  for (let i = 0; i < maxSpins; i++) {
    await game.locator("#kiln-spin:not([disabled])").click();
    let shotTaken = false, featured = false;
    for (let t = 0; t < 120; t++) {
      await page.waitForTimeout(250);
      const status = (await game.locator("#kiln-status").textContent()) ?? "";
      if (FEATURE.test(status)) {
        featured = true;
        if (!shotTaken && /respin/i.test(status)) { await page.waitForTimeout(400); await shot("rps-feature"); shotTaken = true; }
      }
      if (await game.locator("#kiln-spin:not([disabled])").count()) break;
    }
    if (featured) { if (!shotTaken) await shot("rps-feature"); return true; }
  }
  return false;
}

export default async ({ page, step, shot, pause }) => {
  const game = page.frameLocator("#game");
  await step("Kestrel Gaming (invented) offers two slots from Ember Forge Studio, both built on its Kiln framework", async () => { await pause(600); });
  await shot("lobby");
  await step("Land of Rock Paper Scissors: PixiJS reels, tween.js animation, accessible HTML controls", async () => {
    await page.getByRole("button", { name: "Play Land of Rock Paper Scissors" }).click();
    await game.locator("#kiln-spin:not([disabled])").waitFor({ timeout: 30000 });
  });
  await step("Paper wraps rock, scissors cut paper, rock smashes scissors: spinning until one lands", async () => {
    await spinUntilFeature(game, page, shot);
  });
  await step("Sticky wilds held for free respins inside the same paid round; the whole round was frozen before payment", async () => { await pause(1500); });
  await step("History, straight from the game: Catwalk opens this exact round", async () => {
    await game.locator("#kiln-history").click();
    await page.frameLocator("#history").locator("#seal.ok").waitFor({ timeout: 20000 });
  });
  await step("The game's own renderer replays every spin of the round from its reel stops and re-checks the win", async () => { await pause(4500); });
  await shot("round-history");
  await step("Signed by the studio, checked against the wallet, re-checked by the certified rules", async () => { await pause(1200); });
};

export async function mobile({ page, shot, pause }) {
  await page.getByRole("button", { name: "Play Land of Rock Paper Scissors" }).click();
  const game = page.frameLocator("#game");
  await game.locator("#kiln-spin:not([disabled])").waitFor({ timeout: 30000 });
  for (let i = 0; i < 6; i++) { await game.locator("#kiln-spin:not([disabled])").click(); await game.locator("#kiln-spin:not([disabled])").waitFor({ timeout: 30000 }); }
  await pause(400);
  await shot("rps-mobile");
}
