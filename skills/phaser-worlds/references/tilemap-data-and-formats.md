# Tilemap data, formats and GPU-versus-CPU layers (Phaser 4.2.1)

Formats and layer limits; see [terrain/streaming](tilemaps-and-terrain.md), [gotchas](phaser-4-tilemap-gotchas.md), and `node_modules/phaser/skills/tilemaps/SKILL.md`.

Probe: `node examples/web/phaser-probes/phaser-worlds-tilemaps.mjs /path/to/host-project`. [Probe source](../../../examples/web/phaser-probes/phaser-worlds-tilemaps.mjs).

## Where the data comes from

- [documented] Parsers: Tiled JSON (`load.tilemapTiledJSON`), CSV, 2D array and Weltmeister (`src/tilemaps/Formats.js`). Procedural maps use `scene.make.tilemap({ data, tileWidth, tileHeight })`; `insertNull: true` keeps empty cells null.
- [tested] Embed Tiled tilesets. An external `source` logs "External tilesets unsupported", then parsing throws TypeError.
- [tested] Compressed zlib/gzip/zstd layers are skipped with a warning. Export CSV or uncompressed base64 (`parsers/tiled/ParseTileLayers.js`).
- [documented] Groups flatten to `Group/Layer` names, folding offset/opacity/visibility in. Infinite maps become one dense rectangle of all chunks; at about 190 bytes/cell, large worlds need separate chunk files.
- [documented] Tiled flips become `tile.flipX` plus `tile.rotation` of 0, PI/2, PI or 3PI/2 (`ParseGID.js`). Image collections populate `map.imageCollections` for objects only; tile layers require one image per tileset.
- [tested] `addTilesetImage` margin 1/spacing 2 selected the correct tiles from a 20x10 image on CPU and GPU layers.
- [general] Atlas textures can be tileset images (gotcha 7 in [phaser-rendering](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md)).
- [documented] Orientation comes from Tiled: orthogonal 0, isometric 1, staggered 2, hexagonal 3 (`const/ORIENTATION_CONST.js`). The CPU layer picks cull and coordinate functions per orientation; the GPU layer is orthogonal only.
- [tested] The CPU matrix separates authored placement, conversion and paint. Verdict: **partial**; parsing or paint alone does not establish coordinate agreement.

## Measured CPU orientation boundary

- [tested] The probe retains its earlier checks and adds 14 finite 4x4 CPU fixtures: 16x16 cells, four 8x8 markers, embedded tilesets with first GIDs 1/17. Coordinates are independently declared; exact whole-frame PNG/RGBA checks compare authored placement separately from observed source behavior.

| Input | Measured relationship |
| --- | --- |
| Orthogonal; isometric | Agree, using top-left anchors; isometric origin is the `(0,0)` diamond without map-centring offset |
| Staggered y/odd | Agrees; y/even and x/odd/even retain y/odd placement and mismatch |
| Hexagonal y/odd, side 8 | Agrees with a **cell-centre** coordinate anchor |
| Hexagonal y/odd, side 4 | Paint uses side length; conversion retains three-quarter-height spacing |
| Hexagonal y/even, side 4/8 | Authored origin disagrees with paint and conversion offsets |
| Hexagonal x/odd, side 4/8 | Conversion uses tile X in its vertical expression |
| Hexagonal x/even, side 4/8 | Conversion returns undefined components; painted tiles do not establish support |

- [tested] Layer `(100,20)`, 240x120 viewport, scroll `(0,0)` and `(24,8)`, unit zoom/scale/scroll factors, zero rotation, no parent/effects and normal cull padding 1 retain all four markers. **Partial** verdict; edge/offscreen culling, other transforms/side lengths, inverse conversion and collision remain unverified. Export and recheck the exact supported input; GPU stays orthogonal-only.
- [tested] `--mutation wrong-expected` shifts one expected orthogonal coordinate and fails its witness. JSON prints a unique evidence directory with source/fixture hashes, inputs, lossless frames, native state, dispositions and cleanup. Retain failed evidence; partial never waives baseline/adverse failures. Source owners: `Tile.js#updatePixelXY`, `StaggeredTileToWorldXY.js`, `HexagonalTileToWorldXY.js`.

## CPU layer or GPU layer

| | `TilemapLayer` (CPU) | `TilemapGPULayer` |
| --- | --- | --- |
| Renderer | WebGL and Canvas | WebGL only |
| Tilesets | several | the first one |
| Orientation | Four parsed types; exact measured limits above | orthogonal |
| Draw cost | per visible tile, on the CPU | one quad; GPU cost per screen pixel |
| Per-tile tint, alpha, visible | yes | no, layer alpha only |
| Tiled flips and rotations | all | `flipX`, `flipY` only |
| Animation | yes; hand-built frames need `startTime` | yes; needs `animationDuration` (gotchas 3, 10) |
| Empty cell | skipped | paints the sheet's top-left texel (gotcha 2) |
| Culling | `worldView` plus one tile; off when `scrollFactor` is not 1 | none; full quad |
| Edits | draw immediately | call `generateLayerDataTexture()` |
| Position | its own x, y | applied twice (gotcha 1) |

- [documented] Sources: `TilemapLayerWebGLRenderer.js`, `TilemapGPULayer.js`, `TilemapGPULayer-frag.js`, 4.2.0 changelog. Both support [lighting](dynamic-lights.md) and parent matrices.
- [tested] GPU layers draw plain/horizontal Tiled tiles correctly; vertical, anti-diagonal and 180-degree variants draw plain/horizontal. Their data texture stores flips, not `tile.rotation`. Use CPU layers or bake variants.
- [tested] A hand-built animation on a CPU layer animates only if every frame also has `startTime` (the Tiled parser adds it); without it the tile is not drawn at all. Frames are `{ tileid, duration, startTime }` and the tile entry needs `animationDuration`, keyed by local tile id.
- [tested] A CPU layer with `scrollFactor` 0.5 drew all 10,000 tiles every frame; at 1 it drew only the visible ones. A GPU layer honours `scrollFactor`, so use it for parallax backdrops.
- [tested] Both layers keep a `Tile` per cell: about 190 JS-heap bytes/cell (256x256: 12 MB; 1024x1024: 190 MB). Full `generateLayerDataTexture()` rebuilds measured about 0.5 ms at 256x256, 4 ms at 512x512 on one CPU. The 4096x4096 limit needs gigabytes; stream chunks.
- [general] Choose GPU for dense, orthogonal, single-tileset ground in layers up to about 256x256 that change in batches. Choose CPU for sparse content, per-tile tint, rotated tiles, several tilesets, other orientations, a Canvas fallback, or edits every frame.

## Properties and objects

- [documented] Tiled custom properties arrive as `tileset.tileProperties[localId]` and `tile.properties`; `layer.setCollisionByProperty({ collides: true })` reads them. Tile `type` and collision shapes are in `tileset.tileData`. A procedural map has none, so keep your own table keyed by tile index.
- [documented] `map.getObjectLayer(name).objects` returns raw objects (`id`, `name`, `type`, `x`, `y`, `width`, `height`, shape flags, `properties` as Tiled's array). `createFromObjects(layer, { gid | id | name | type, classType, key, frame, container })` builds sprites and converts Tiled's bottom-left tile-object origin (`Tilemap.js#createFromObjects`).
- [tested] Matrix objects retain raw `(24,8)`/`(48,16)`; 8x8 rectangle/tile objects become centres `(28,12)`/`(52,12)`, or `(20,36)`/`(36,60)` in square-cell isometric. Separate frames verify these unrotated examples. GID 18 selects second-tileset local frame 1; the texture explicitly defines matching frames, required by `ObjectHelper.js` for automatic object lookup.
- [documented] Object properties are copied onto the sprite: a property named like an existing field (`depth`, `alpha`, `visible`, `x`) overwrites that field and any other goes to `sprite.setData` (`ObjectHelper.js#setFromJSON`). Name Tiled properties with a prefix to stay out of the way.
- [tested] `sortByY` is read from the config array itself, so `createFromObjects('o', { sortByY: true })` does nothing. Sort `getObjectLayer(name).objects` yourself before the call.

## Editing at runtime

- [tested] A second `createLayer` for one `LayerData` warns and returns null. Pooled views must rewrite tiles (`putTilesAt`, `fill`) or destroy the existing view first.
- [documented] A GPU layer does not redraw on `putTileAt`; batch your edits and call `generateLayerDataTexture()` once per frame. Each call makes a new data texture and leaks the old GL wrapper (gotcha 13 in [phaser-rendering](../../phaser-rendering/references/phaser-4-webgl-context-gotchas.md)).
- [general] Keep GPU layers chunk sized (32x32 regenerates in about 0.1 ms) and repaint a tile and its eight neighbours when a blend overlay depends on neighbours.
- [general] Tile collision reads the layer's own position, not its container's, so a GPU layer parked at (0, 0) in a chunk Container needs another collision source; the options are in [phaser-physics](../../phaser-physics/references/tilemap-collision.md).

## Verify

- [general] Read `layer.tilesDrawn` and `tilesTotal` on a CPU layer to prove culling, and one pixel at a tile whose index you know to prove the right layer is on top ([verifying](../../phaser-verification/references/verifying-on-a-gpu.md)). Assert `map.layers.length` after loading Tiled JSON, because a skipped layer is silent.
