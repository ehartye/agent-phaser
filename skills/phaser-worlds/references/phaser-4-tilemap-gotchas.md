# Phaser 4.2.1 tilemap gotchas

Tilemap layers, tile animation, containers and per-tile motion. Numbers match the index in [phaser-4-gotchas.md](../../phaser-rendering/references/phaser-4-gotchas.md).

## 1. `TilemapGPULayer` draws at twice its position

- [general] **Symptom.** Only the tilemap at the world origin renders. Others vanish or appear far away.

**Cause.** `SubmitterTilemapGPULayer.run()` builds `spriteMatrix.applyITRS(x, y, ...)` and then computes the quad corners
from `(x, y)` to `(x + width, y + height)`. The layer position is applied twice (a fix: build the quad from (0, 0) to (width, height)).

**Evidence.** A layer at x = -256 ended exactly at world 0 (it was drawn at -512). Moving every layer to (0, 0) and
positioning a parent container fixed it. A test with all four chunks near the origin passed anyway: overlapping ranges hid it.

**Workaround.** Keep GPU layers at (0, 0) and position a parent `Container`; the container matrix reaches the layer
through `parentMatrix` and is correct. Tile collision reads the layer's own x, y, not the container's ([tilemap collision](../../phaser-physics/references/tilemap-collision.md)). A container has one depth, so split layers that need different depths (for
example a roof above entities and ground below them) into separate containers.

## 2. Empty tiles in a GPU layer render as an opaque tile 0

**Symptom.** A mostly empty GPU layer used as an overlay covers everything beneath it with the tileset's first tile.
Terrain looks like uniform dust even though the data underneath is correct.

**Cause.** A `-1` (empty) tile in a `TilemapGPULayer` is drawn as tile index 0 instead of being transparent in this
configuration.

**Evidence.** A 4x4 GPU layer, left half asphalt and right half `-1`, over a water layer: the right half drew dust (tile
0) [general] and hid the water. `layer.getTileAt(x, y, true).index` returned `-1`, so the data was right and the draw was wrong.
In a real map, two overlay layers about 95% empty hid the terrain on every chunk.

**Workaround.** A GPU layer must be full. Use it for the dense base ground and make the code that fills it incapable of
emitting -1. Use a CPU `TilemapLayer` for anything sparse (overlays, objects, roofs, floors).

**Refinement (read from `TilemapGPULayer-frag.js`).** The layer data does mark `-1` as empty, but the shader's empty branch
returns texel coordinate `(0, 0)` of the tileset for the whole quad, so the tile is filled with the colour of the sheet's
**top-left pixel**, not a lookup of tile 0's art. That makes a sparse GPU layer possible: make cell 0 of the tileset fully
transparent (an explicit `empty` cell first in the sheet) and "empty" becomes transparent. Sheets whose first cell is opaque
(a terrain sheet starting with dust) still need full layers. See gotcha 10 for what sparse GPU layers are good for.

**Related crash.** `removeTileAt(x, y, true)` leaves `null` in the layer; `generateLayerDataTexture()` then throws
`Cannot read properties of null (reading 'index')`. Use `removeTileAt(x, y, false)` on a GPU layer.

## 3. Hand-built tile animations need `animationDuration`

- [general] **Symptom.** An animated water tile in a GPU layer draws the wrong tile (sand-coloured) instead of cycling frames.

**Cause.** `Tileset.createAnimationDataTexture` reads `tileData[i].animationDuration` in addition to `animation`. The
Tiled parser fills both. Procedural `tileData` that only sets `animation` leaves the duration undefined, so the shader
divides time by zero.

**Fix.**

```ts
tileset.tileData[firstFrameIndex] = {
  animation: frames.map((f, i) => ({ tileid: f, duration: 250, startTime: 250 * i })),
  animationDuration: 250 * frames.length,   // GPU shader needs it; startTime is for CPU layers
};
```

- [tested] A CPU layer binary-searches `startTime` (`Tileset#getAnimatedTileId`); frames without it make the tile vanish. Probe: [tilemap probe](../../../examples/web/phaser-probes/phaser-worlds-tilemaps.mjs).

## 8. A Container's alpha does not reach the CPU tilemap layers inside it

- [general] `container.setAlpha(0.25)` changed nothing on screen when the container held a `TilemapLayer`; the scene graph said 0.25
  and the pixel was unchanged (a roof fade was silently broken). Set alpha on the layer itself. Verify fades with a pixel
  read of a tile with the effect on and off.
- [tested] A `Layer` and a GPU layer behave the same: they set four corner alphas that tile layers never read (same probe).

## 10. Shader tile animations: the second animation plays the wrong tiles

- [general] **Symptom.** After registering several tile animations (swaying plants, pulsing crystals), a row of one plant draws tiles of
  other plants (wildflowers showed mushrooms and dry grass). The first animation registered (water) was always right.
  A CPU `TilemapLayer` animates only with `startTime` frames (gotcha 3).

**Cause.** `TilemapGPULayer` animates tiles in the shader (`tileData[i].animation`, read by `Tileset.createAnimationDataTexture`). That
texture stores each animation as a pair of 32-bit values, so animation `n` sits at texels `2n` and `2n + 1`. The fragment shader
(`animationIndex` in `TilemapGPULayer-frag.js`) reads texels `n` and `n + 1`, and `generateLayerDataTexture` writes the map value
`n` unchanged into the layer data. They agree only for `n = 0`.

**Workaround.** After registering `tileData`, and before the first GPU layer is created from that tileset, double the
tile-to-animation map once:

```ts
const map = tileset.getAnimationDataIndexMap(renderer);          // creates the animation texture and the map
for (const [tile, anim] of map) map.set(tile, anim * 2);         // the shader reads texel 2n
```

Keep a `WeakSet` so it is applied once per tileset. Verify by animating three different tiles and reading the screen.

**Also.** To desynchronise a field of animated tiles (no per-tile phase in the shader), register one animation per phase (the
same frames started a quarter apart); phase tiles need their own sheet cells because `tileData` is keyed by tile index.
Put sparse animated content (plants, glow, drips) in its own sparse GPU layer (gotcha 2 refinement).

## 18. CPU tilemap layers inside a positioned container are culled as if the container were at the origin

- [general] `CullBounds` subtracts the layer's *own* `x, y` from `camera.worldView` and never looks at a parent container
  (`src/tilemaps/components/CullBounds.js#L27`). A layer at (0, 0) inside a container at (2560, 0) is judged to be far from a camera looking
  at 2560, so only some tiles draw: landmarks, covers and wall pieces vanish at random; a GPU ground layer is unaffected. Fixes: set
  `layer.skipCull = true` (`src/tilemaps/components/CullTiles.js#L28`), after which a visible layer walks all its tiles every frame, so hide
  off-screen views ([performance](../../phaser-verification/references/performance.md)); or give the layer its real world x, y and parent it
  to nothing or to a `Layer`, which adds no transform. Test: read the pixel at a landmark tile in a far chunk with and without the fix.
- [tested] A CPU layer at x 2560 inside a `Layer` drew its tiles; the same layer at (0, 0) inside a container at x 2560 drew none (same probe).

## 20. Per-plant motion on tilemaps: split the layer by phase, move the parent container

A tilemap layer has no per-tile transform, so per-plant sway cannot be a vertex tweak. What works with no per-tile work and no per-frame
allocation: quantise the phase (four classes of `(tx + (ty >> 1)) mod 4`), keep one **GPU tile layer per class**, route each tile into its class's layer when it is
painted (remember the slot per tile so a tile that changes class leaves the old layer), and put each layer in its own `Container` whose `x` is that class's
whole-pixel offset this frame. Measured on 4.2.1:

- [general] Move the **container**, not the layer: a `TilemapGPULayer` applies its own x/y twice (gotcha 1); a nested container composes correctly with the chunk container above it.
- [general] A GPU layer holding no tiles must be `setVisible(false)`, or Phaser still submits a quad for it; keep a live-tile count per layer. Eight extra GPU layers per chunk added
  one draw call per visible layer and no measurable CPU time (one project, not reproduced here).
- [general] A mutation behind the sim's back (writing chunk arrays) does not repaint; only change events and a rebind do. In a test, release and rebind the streamer.
- [general] With the sim **paused** the view interpolates `prev` to `player` with alpha 0, so a teleported player is drawn where it was and the camera never arrives: take one tick, run ~30 frames, then pause.
- [general] Gate the effect from the view side only (weather, the view clock, tile coordinates, Reduce motion); never read the sim for time, so frame-stepped tests are exact.
- [general] The whole 16 px tile moves as a unit (crowns slide over a still trunk); a true bend needs a vertex shader on the tilemap layers.
