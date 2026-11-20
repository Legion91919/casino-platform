# Art prompts (ChatGPT image generation)

Each game's symbols come from **one sheet** so every symbol shares one style, then
`kiln/scripts/import-art.ts --sheet` cuts the sheet into sprites. Backgrounds are separate images.
Save results into `art-inbox/<game>/` and import (commands at the bottom).

## Land of Rock Paper Scissors

**Symbol sheet** (square, 1024x1024):
> A game asset sprite sheet for a cheerful casual slot game called "Land of Rock Paper Scissors". Exactly 12 separate icons arranged in a strict 4 columns by 3 rows grid, each icon centred in its own equal square cell with generous empty space around it, nothing touching or crossing cell edges. Style: glossy hand-painted papercraft look, soft studio lighting, bold clean dark outline, rich saturated colours, slight three-quarter view, mobile game quality. Fully transparent background, no grid lines, no labels except where stated.
> Row 1: (1) an origami paper crane in teal with a small yellow "WILD" ribbon banner, (2) a chunky grey boulder rock, (3) a crisp sheet of cream paper with a folded corner and a few blue lines, (4) open scissors with red handles.
> Row 2: (5) a bright yellow paper-cut sun with no face, (6) a purple crescent moon, (7) an orange-red five-pointed star, (8) a fluffy pale blue cloud.
> Row 3: (9) a grey rock completely wrapped in cream paper tied with red string, with a small yellow "WILD" ribbon banner, (10) a sheet of paper torn into two halves with jagged edges, glowing slightly, with a small yellow "WILD" ribbon banner, (11) empty, (12) empty.

Import names (in grid order): `crane,rock,paper,scissors,sun,moon,star,cloud,wrapped,torn`

**Background** (landscape, 1536x1024):
> A wide landscape background for a casual slot game, papercraft diorama style: layered paper-cut rolling hills in soft greens and kraft brown, a pale cream sky with a soft yellow paper sun and a couple of paper clouds, gentle depth with drop shadows between layers. Calm and uncluttered in the centre (game reels go there). No characters, no text, no UI.

## Ember Anvil

**Symbol sheet** (square, 1024x1024):
> A game asset sprite sheet for a fantasy blacksmith slot game called "Ember Anvil". Exactly 9 separate icons arranged in a strict 3 columns by 3 rows grid, each icon centred in its own equal square cell with generous empty space, nothing touching cell edges. Style: rich painterly fantasy game art, realistic forged metal and gem materials, warm ember-orange rim light, bold silhouette, mobile slot quality. Fully transparent background, no grid lines, no text except where stated.
> Row 1: (1) a living ember flame, white-hot core, with a small gold "WILD" plate, (2) a glowing purple clay crucible pouring molten metal, (3) a heavy steel anvil.
> Row 2: (4) a blacksmith's hammer, (5) iron blacksmith tongs holding a red-hot bar, (6) a stacked gold ingot.
> Row 3: (7) a cut ruby gem, (8) a polished jade cabochon, (9) a steel hex rivet.

Import names: `ember,crucible,anvil,hammer,tongs,ingot,ruby,jade,rivet`

**Background** (landscape, 1536x1024):
> A wide background for a fantasy slot game: the inside of a stone blacksmith forge at night, warm glow from a banked fire low in the centre, soot-dark brick walls, hanging tools as silhouettes at the edges, floating embers. Darker and calm in the centre (game reels go there). No characters, no text, no UI.

## Import
```bash
node studios/ember-forge/kiln/scripts/import-art.ts studios/ember-forge/rock-paper-scissors --sheet art-inbox/rps/sheet.png --grid 4x3 --names crane,rock,paper,scissors,sun,moon,star,cloud,wrapped,torn
node studios/ember-forge/kiln/scripts/import-art.ts studios/ember-forge/rock-paper-scissors --dir art-inbox/rps   # background.png
node studios/ember-forge/kiln/scripts/import-art.ts studios/ember-forge/ember-anvil --sheet art-inbox/anvil/sheet.png --grid 3x3 --names ember,crucible,anvil,hammer,tongs,ingot,ruby,jade,rivet
```
