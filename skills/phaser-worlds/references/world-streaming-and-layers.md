# World structure in Phaser 4.2.1: Layer, Container, z-order, parallax, streaming and HUD

How to organise the display objects of a world bigger than the screen: which grouping object to use, how depth works, what to hide and when, and where the HUD lives. Pooled tile-chunk views and the per-chunk layer plan are in [tilemaps and terrain](tilemaps-and-terrain.md); camera numbers are in [cameras](cameras.md).

Probes: `node examples/web/phaser-probes/phaser-worlds-layers.mjs /path/to/host-project`, plus [the tilemap probe](../../../examples/web/phaser-probes/phaser-worlds-tilemaps.mjs) for alpha and culling. Every [tested] bullet below is a check in [the layers probe](../../../examples/web/phaser-probes/phaser-worlds-layers.mjs) or the tilemap probe.

## Layer, Container or Group

| | `Layer` | `Container` | `Group` |
| --- | --- | --- | --- |
| Draws | yes, a Game Object since 4.1.0 | yes | no, a set of objects |
| Transform | none | x, y, scale, rotation | none |
| Child order | by child `depth` | list order; `sort('y')` | n/a |
| Scroll factor | not applied | multiplied into children | n/a |
| `camera.ignore` | marks the Layer, late children covered | marks the container | children present at the call only |
| Filters | yes | yes | no |
| Nesting | holds Containers; cannot sit in one | holds children, nests | n/a |

- [documented] A Layer has Alpha, BlendMode, Depth, Mask and Visible but no position, scale, scrollFactor, input or lighting; Containers can go into Layers and Layers cannot go into Containers (`src/gameobjects/layer/Layer.js`). Since 4.1.0 it is a real Game Object, which is why filters work on it (`changelog/v4/4.1/CHANGELOG-v4.1.0.md`).
- [tested] In a Layer the higher child depth draws on top; in a Container child depth is ignored and list order decides until you call `container.sort('y')`.
- [tested] Layer alpha 0.5 faded an Image but left a CPU tile layer opaque, and Container alpha 0.5 left a GPU tile layer opaque; both multiply `setAlpha` corners that tile layers never read. Fade tile layers on the layer itself (gotcha 8 in [tilemap gotchas](phaser-4-tilemap-gotchas.md)).
- [tested] A CPU tile layer at x 2560 inside a Layer culls correctly, because a Layer adds no transform; the same layer at (0, 0) inside a Container at x 2560 drew nothing (gotcha 18). A GPU tile layer must sit in a positioned Container (gotcha 1), and Layer > Container > GPU layer draws at the container position.
- [tested] `layer.enableFilters()` plus `layer.filters.external.addColorMatrix()` greyed an Image inside the Layer and left one outside it on the same camera. A world Layer can take the grade while the HUD shares the camera; a camera filter is the choice when everything on that camera should change.
- [general] Lighting has no group switch. Call `setLighting(true)` on each child, again after every pooled rebind ([lights](dynamic-lights.md)).

## Depth and z-order in a tile world

- [documented] The scene sorts its display list with a stable sort whenever a depth changes (`DisplayList`); equal depths keep list order, so pooled objects have a history-dependent order. Give every layer an explicit depth and leave nothing at the default tie.
- [tested] Setting `depth = y` on 5,000 Images every frame cost about 0.2 ms of sorting; with no change it cost 0 (one desktop CPU). Y-sorting at that scale is not a performance problem.
- [general] A plan that works: ground GPU layers at depth 0, decals and overlays above, entities and props at `depth = base + y`, roofs and canopy at a high depth, HUD in its own scene. One Container per chunk holds the chunk's layers; one Layer holds the Containers that share a depth band.

## Parallax and scrolling backdrops

- [tested] A GPU tile layer honours `setScrollFactor(0.5)`: with the camera at 16 px it was shifted by 8 px. A CPU tile layer with a scroll factor other than 1 draws every tile every frame, so use a GPU layer for a big parallax backdrop.
- [documented] For a repeating texture, Phaser's `TileSprite` is meant to be viewport sized and scrolled with `tilePositionX/Y` (`src/gameobjects/tilesprite/TileSprite.js`); the whole-pixel version is in [ambient motion](ambient-motion.md).
- [documented] Sprites and images take `setScrollFactor` as in Phaser 3; a Container multiplies its own factor into each child (`ContainerWebGLRenderer.js`); `SpriteGPULayer` members take their own `scrollFactorX/Y` ([GPU layer reference](../../phaser-rendering/references/sprite-gpu-layer-and-batching.md)).

## Hide what is far away

- [tested] Nothing culls sprites by position, but one `setVisible(false)` on a Container submitted none of its 300 children, and ten thousand hidden Images cost about 0 ms against about 1 ms visible ([cameras](cameras.md)).
- [general] Bucket entities by chunk. When a chunk enters the keep-alive ring (view plus one chunk, measured from the follow target), show its Container; when it leaves, hide it. One write per chunk, not per sprite.
- [tested] `sprite.setActive(false)` stops a sprite's animation updates, because the update list skips inactive objects. Hide and deactivate together for far-away animated things; keep their logic in the simulation, not in display objects.
- [general] Create objects for a chunk when it first enters the ring and pool them; destroying and recreating while scrolling causes hitches and, for tile layers, leaks (gotcha 13).

## World space and screen space

- [tested] `setScrollFactor(0)` is not screen space under zoom ([cameras](cameras.md)). Put the HUD in a UI scene with its own camera at the UI scale.
- [general] A bar or number that follows an entity: if it should scale with the world, put it in the world's top-depth Layer; if text must stay at the UI scale, draw it in the UI scene at `(worldX - worldView.x) * zoom`, updated from the display object each frame.
- [general] Keep one rule: world objects never read the UI camera, UI objects never read the world camera, and a conversion helper in one file is the only bridge.

## Memory and lifetime

- [tested] A tilemap keeps about 190 bytes of JS heap per cell on either layer type ([data and formats](tilemap-data-and-formats.md)).
- [documented] A bound chunk is its tile objects, its layers and, per GPU layer, one RGBA data texture of 4 bytes per cell (`TilemapGPULayer.js#generateLayerDataTexture`).
- [documented] `Tilemap.destroy()` destroys its layers, but regenerating a GPU layer leaves a dead texture wrapper behind and the layer's own destroy never frees its data texture (`TilemapGPULayer.js#generateLayerDataTexture`, gotcha 13). Pool the views and rewrite their tiles.
- [general] A level change releases every bound view and restarts the ring from the new spawn; count live views, layers and `renderer.glTextureWrappers` before and after to prove nothing grows.

## Verify

- [general] Assert the visible chunk set equals the set derived from the follow target and margin, `scene.children.list.filter((o) => o.visible).length` stays flat while scrolling, and one pixel at a known tile in the far chunk matches ([verifying](../../phaser-verification/references/verifying-on-a-gpu.md)).
