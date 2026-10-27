# Normal-mapped sprites from a paired atlas (Phaser 4.2.1)

Read this when a sprite export arrives as a colour atlas plus a normal atlas (the agent-sprites paired export) and you want a lit Phaser sprite: the loader call, how frames line up, animation tags, the pivot, and which way the light falls. Light setup itself is in [dynamic lights](dynamic-lights.md). Backed by `phaser-worlds-normal-atlas.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md) and `tests/phaser-worlds-normal-atlas.test.mjs`, both run on a real export kept in `tests/fixtures/normal-atlas/` (three 32 x 24 poses, 13.6 KB).

## What the export gives you

- [tested] A build with `normal: true` writes, among other files, a colour PNG, a normal PNG, a colour atlas (Aseprite style: a `frames` array, trim, `duration` per frame, `frameTags`, a `pivot` slice) and a normal atlas that copies the colour atlas's frame rectangles, trim, sizes, durations, tags and pivot. The test checks that every colour frame has a normal frame with the same rectangle, trim, size and duration, that both images have the atlas size, and that the metadata says the normal image is `green: up`, flat `128 / 128 / 255`; the pixels agree (the top of the dome has green above 150, the bottom below 106, the left red below 106).
- [general] The colour PNG carries an offline light baked into it (the export's notes say so). A runtime light adds to that, so a sprite that looks double lit needs a colour image exported without the bake (the export's notes say clearing the cell lighting keeps the normals and material data); that is an export setting, not a Phaser one, and it was not tried here.
- [tested] Frame names are `"0"`, `"1"`, `"2"`, then `"3"` to `"5"` (the animation group's sequence, the same rectangles again) and the cell names (`lamp-0` to `lamp-2`). Tag `from` and `to` are positions in the `frames` array.

## Load it

- [tested] `this.load.atlas('hero', ['hero.png', 'hero-normal.png'], 'hero.json')` takes the colour atlas JSON only. Nine frames loaded once, `texture.dataSource[0]` was the normal image at the colour image's size, and every frame's rectangle, trim offset and source size in Phaser equalled the atlas JSON. Phaser addresses the normal image with the colour frame's rectangle, so the normal atlas is never read at runtime; keep it as a build-time check (the test above) that the two describe the same frames. Without the array form there is no `dataSource` and the renderer's flat normal is used.
- [documented] The config form is `{ key, textureURL, normalMap, atlasURL }` (`src/loader/filetypes/AtlasJSONFile.js`). `load.aseprite` takes one texture and one JSON and has no normal-map parameter (`AsepriteFile.js`), so a lit, tagged sheet is loaded with `load.atlas`.
- [general] Pack a character's poses into one atlas pair so the lit sprites batch. A normal map doubles the texture memory of a sheet and every lit draw samples both images.

## Tags and the pivot

- [tested] `load.atlas` does not put the JSON in `cache.json`. `anims.createFromAseprite('hero')` returned an empty list and warned until the JSON was added under the texture key: `this.cache.json.add('hero', this.cache.json.get('heroJson'))` after a `load.json('heroJson', url)`. The texture and JSON caches are separate, so the texture key can be reused.
- [tested] The fixture's tag `sweep` has direction `pingpong_reverse` (authored C, B, A, B). `createFromAseprite` made one animation over frames `3, 4, 5` played forward, because Phaser handles `reverse` and `pingpong` only (`src/animations/AnimationManager.js`). Make that animation yourself: `anims.create({ key: 'sweep', frames: ['5', '4', '3', '4'].map((frame) => ({ key: 'hero', frame, duration: hold[frame] })) })` played `5, 4, 3, 4`. `yoyo: true` over `5, 4, 3` played `5, 4, 3, 4, 5`, one frame too many.
- [documented] `createFromAseprite` reads `frames[i]` for each position `i` in the tag, so an export whose `frames` array is ordered by position works only while the frame names equal their positions, as they do here. Read the tag range against the names before trusting a different export.
- [tested] A trimmed frame's sprite is the size of the untrimmed cell (32 x 24 here), so the pivot `(16, 22)` is `sprite.setOrigin(16 / 32, 22 / 24)`; `displayOriginX` and `displayOriginY` then read 16 and 22.

## Light it

- [documented] Enable lights, then opt each sprite in: `scene.lights.enable()` and `sprite.setLighting(true)` ([dynamic lights](dynamic-lights.md)).
- [tested] The export's green-up normals need no flip in Phaser 4.2.1. With a light at radius 2000, intensity 2 and height `z` 120 placed far off to one side of the sprite drawn at 6 x, the share of the dome's brightness on its left half was 0.74 higher with the light on the left than on the right, and the top half's share was 0.72 higher with the light above than below. The same sprite loaded without the normal image moved by 0.04 and 0.03: that is only the distance to the light. Both numbers were identical on the software rasteriser and on a Direct3D 11 hardware backend.
- [tested] Controls in the same probe: inverting the green channel gave a vertical swing of -0.72 and kept the horizontal one at 0.74; inverting red gave a horizontal swing of -0.73. If a lit sprite is bright on the wrong side, the normal image is flipped on that axis: fix the export, not the shader. The probe's controls also show it would catch such a flip.
- [general] Judge a normal map by comparing opposite lights on the same sprite, as the probe does, never against a stored screenshot: baked colour, ambient and distance all change the absolute level.

## Verify

- [tested] `node --test tests/phaser-worlds-normal-atlas.test.mjs` (merge lane) checks the pair; `node examples/web/phaser-probes/phaser-worlds-normal-atlas.mjs <host>` runs the loader, tag, pivot and light checks (software or `--hardware`).
- [general] A new export: run the test on its four files first. If the green or red check fails, the encoding changed; read `meta.normalEncoding` in the normal atlas before touching the game.
