# Phaser 4.2.1 gotchas

Each entry: symptom, cause, evidence, workaround. All observed on Phaser 4.2.1 (the `latest` release, published
2026-07-09) in WebGL on an NVIDIA GPU through ANGLE/D3D11, in the Fallow Valley project. Where a bug is Phaser's, the
upstream `master` source was checked on 2026-10-05; none of these is reported upstream yet, and the suggested fixes are
ours.

## 1. `TilemapGPULayer` draws at twice its position

**Symptom.** Only the tilemap at the world origin renders. Others vanish or appear far away.

**Cause.** `SubmitterTilemapGPULayer.run()` builds `spriteMatrix.applyITRS(x, y, ...)` and then computes the quad corners
from `(x, y)` to `(x + width, y + height)`. The layer position is applied twice.

**Evidence.** A layer at x = -256 ended exactly at world 0 (it was drawn at -512). Moving every layer to (0, 0) and
positioning a parent container fixed it. A test with all four chunks near the origin passed anyway, because the
overlapping ranges hid it.

**Workaround.** Keep GPU layers at (0, 0) and position a parent `Container`; the container matrix reaches the layer
through `parentMatrix` and is correct. A container has one depth, so split layers that need different depths (for
example a roof above entities and ground below them) into separate containers.

**Suggested upstream fix.** Build the quad from (0, 0) to (width, height) because the matrix already carries x and y.

## 2. Empty tiles in a GPU layer render as an opaque tile 0

**Symptom.** A mostly empty GPU layer used as an overlay covers everything beneath it with the tileset's first tile.
Terrain looks like uniform dust even though the data underneath is correct.

**Cause.** A `-1` (empty) tile in a `TilemapGPULayer` is drawn as tile index 0 instead of being transparent in this
configuration.

**Evidence.** A 4x4 GPU layer, left half asphalt and right half `-1`, over a water layer: the right half drew dust (tile
0) and hid the water. `layer.getTileAt(x, y, true).index` returned `-1`, so the data was right and the draw was wrong.
In the game, two overlay layers (about 95% empty) hid the real terrain on every chunk; hiding them restored the colours.

**Workaround.** A GPU layer must be full. Use it for the dense base ground and make the code that fills it incapable of
emitting -1. Use a CPU `TilemapLayer` for anything sparse (overlays, objects, roofs, floors).

**Related crash.** `removeTileAt(x, y, true)` leaves `null` in the layer; `generateLayerDataTexture()` then throws
`Cannot read properties of null (reading 'index')`. Use `removeTileAt(x, y, false)` on a GPU layer.

## 3. Hand-built tile animations need `animationDuration`

**Symptom.** An animated water tile in a GPU layer draws the wrong tile (sand-coloured) instead of cycling frames.

**Cause.** `Tileset.createAnimationDataTexture` reads `tileData[i].animationDuration` in addition to `animation`. The
Tiled parser fills both. Procedural `tileData` that only sets `animation` leaves the duration undefined, so the shader
divides time by zero.

**Fix.**

```ts
tileset.tileData[firstFrameIndex] = {
  animation: frames.map((f) => ({ tileid: f, duration: 250 })),
  animationDuration: 250 * frames.length,   // required
};
```

## 4. A missing `import Phaser` compiles, then fails at runtime

Phaser's typings declare a global namespace. `new Phaser.Geom.Rectangle(...)` type-checks in a file that never imports
Phaser, and the page throws `Phaser is not defined` when that code runs. Add a test that scans game files for runtime
uses (`new Phaser.`, `Phaser.Math`, `Phaser.Scale`, `Phaser.BlendModes`, `Phaser.WEBGL`, key-code constants and so on)
and requires the import.

## 5. `anims.createFromAseprite` registers animations under the bare tag name, globally

**Symptom.** The second creature or character looks frozen or plays another creature's animation.

**Cause.** Every agent-sprites sheet has tags like `walk_right`. `createFromAseprite(key)` creates each animation with
`key: <tag name>` in the single global animation table; a second atlas with the same tag names creates nothing new
because the key already exists.

**Fix.** Create the animations yourself, namespaced `<atlasKey>:<tag>`, from the cached Aseprite JSON: for each
`meta.frameTags` entry, frames `from..to` as `{ key: atlasKey, frame: String(i), duration: data.frames[i].duration }`.
`createFromAseprite(key, tags, sprite)` with a sprite target avoids the collision but builds per-sprite animation state.

## 6. Phaser 4 removed `setTintFill`

Use tint modes: `sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)` for a hit flash, then
`setTintMode(Phaser.TintModes.MULTIPLY)`. Modes are MULTIPLY, FILL, ADD, SCREEN, OVERLAY and HARD_LIGHT.

## 7. Smaller observations

- `Tilemap.createBlankLayer` has no GPU argument. Build GPU layers with `make.tilemap({ data })` and
  `createLayer(0, tileset, 0, 0, true)`. A 2D array of tile indices is enough; no Tiled file is needed.
- GPU layers do not repaint on `putTileAt`. Call `generateLayerDataTexture()` once after a batch of edits. Calling it
  many times in a frame across many layers works.
- A tileset image can be a texture that also has atlas frames: `addTilesetImage(name, textureKey, w, h, 0, 0)` uses the
  source image, so a gapless sprite sheet doubles as a tileset.
- `Phaser.Types` and the camera `worldView` are in world pixels; with zoom 3 a 1280 px canvas shows about 427 world
  pixels. Compute visible chunks from `worldView`, not from the canvas size.
- The Phaser `skills` folder inside the package is the fastest accurate reference for v4 APIs.

## How these were found (do it this way)

1. Build the smallest standalone version in the live scene (`scene.make.tilemap({ data })` plus a layer inside a
   container) and compare with the real pipeline.
2. Read a screenshot pixel at a tile whose data you know, then toggle the other layers one at a time and read again.
3. Print the layer data and compare with the pixel: that separates a data bug from a render bug.
4. Read Phaser's source for the render node (`src/renderer/webgl/renderNodes/submitter/`) once you have a suspect.
5. Re-introduce the bug and confirm the regression test fails.
