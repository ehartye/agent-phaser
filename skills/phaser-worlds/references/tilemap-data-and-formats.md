# Tilemap data, formats and GPU-versus-CPU layers (Phaser 4.2.1)

Where map data comes from, what each layer type can and cannot do, and how editing behaves. The chunked layer plan, blends and procedural terrain are in [tilemaps and terrain](tilemaps-and-terrain.md); numbered traps are in [tilemap gotchas](phaser-4-tilemap-gotchas.md). Phaser's own tour is `node_modules/phaser/skills/tilemaps/SKILL.md`.

Probe: `node examples/web/phaser-probes/phaser-worlds-tilemaps.mjs /path/to/host-project`. Every [tested] bullet below is a check in [the probe](../../../examples/web/phaser-probes/phaser-worlds-tilemaps.mjs).

## Where the data comes from

- [documented] Four parsers: Tiled JSON (`load.tilemapTiledJSON`), CSV, a 2D array and Weltmeister (`src/tilemaps/Formats.js`). A procedural world uses the array form with no file: `scene.make.tilemap({ data, tileWidth, tileHeight })` or `add.tilemap(key, tw, th, w, h, data, insertNull)`; `insertNull: true` leaves empty cells null for sparse static data.
- [tested] Tiled JSON needs embedded tilesets. An external tileset (`source`) logs "External tilesets unsupported", then parsing throws a TypeError and the scene's `create` dies. Export with "Embed tilesets".
- [tested] A zlib, gzip or zstd layer is skipped with a warning, so the map loads with zero layers and only a console warning. Export as CSV or uncompressed base64 (`parsers/tiled/ParseTileLayers.js`).
- [documented] Group layers flatten to `Group/Layer` names with offset, opacity and visibility folded in. An infinite map parses into one dense rectangle covering every chunk, and a tilemap costs about 190 bytes per cell (below), so a large world wants its own chunk files, not an infinite Tiled map.
- [documented] Tiled flip flags become `tile.flipX` plus `tile.rotation` of 0, PI/2, PI or 3PI/2 (`parsers/tiled/ParseGID.js`). A "collection of images" tileset parses into `map.imageCollections` for objects only; tile layers cannot draw it, so keep one image per tileset.
- [tested] `addTilesetImage(name, key, tileW, tileH, margin, spacing, gid)` reads margin and spacing on both layer types: a 20x10 image with margin 1 and spacing 2 picked the right tiles on CPU and GPU layers.
- [general] A texture that also has atlas frames can serve as the tileset image (gotcha 7 in [phaser-rendering](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md)).
- [documented] Orientation comes from Tiled: orthogonal 0, isometric 1, staggered 2, hexagonal 3 (`const/ORIENTATION_CONST.js`). The CPU layer picks cull and coordinate functions per orientation; the GPU layer is orthogonal only.
- [tested] Isometric and staggered Tiled maps draw on CPU layers at the positions `tileToWorldXY` returns. Hexagonal is parsed and culled by its own functions but was not probed.

## CPU layer or GPU layer

| | `TilemapLayer` (CPU) | `TilemapGPULayer` |
| --- | --- | --- |
| Renderer | WebGL and Canvas | WebGL only |
| Tilesets | several | the first one |
| Orientation | orthogonal, isometric, staggered, hexagonal | orthogonal |
| Draw cost | per visible tile, on the CPU | one quad; GPU cost per screen pixel |
| Per-tile tint, alpha, visible | yes | no, layer alpha only |
| Tiled flips and rotations | all | `flipX`, `flipY` only |
| Animation | yes; hand-built frames need `startTime` | yes; needs `animationDuration` (gotchas 3, 10) |
| Empty cell | skipped | paints the sheet's top-left texel (gotcha 2) |
| Culling | `worldView` plus one tile; off when `scrollFactor` is not 1 | none; full quad |
| Edits | draw immediately | call `generateLayerDataTexture()` |
| Position | its own x, y | applied twice (gotcha 1) |

- [documented] The table follows `src/tilemaps/TilemapLayerWebGLRenderer.js`, `TilemapGPULayer.js`, the shader `TilemapGPULayer-frag.js` and the 4.2.0 changelog ("TilemapGPULayer does not support tinting on tiles"). Both render with lighting ([lights](dynamic-lights.md)) and with a parent matrix.
- [tested] Tiled flips on a GPU layer: none and horizontal draw right, but vertical, anti-diagonal and 180 degree tiles drew as plain or horizontal. The data texture stores only `flipX` and `flipY`, and Tiled's rotations live in `tile.rotation`. Use a CPU layer for maps authored with rotated or vertically flipped tiles, or bake those variants into the tileset.
- [tested] A hand-built animation on a CPU layer animates only if every frame also has `startTime` (the Tiled parser adds it); without it the tile is not drawn at all. Frames are `{ tileid, duration, startTime }` and the tile entry needs `animationDuration`, keyed by local tile id.
- [tested] A CPU layer with `scrollFactor` 0.5 drew all 10,000 tiles every frame; at 1 it drew only the visible ones. A GPU layer honours `scrollFactor`, so use it for parallax backdrops.
- [tested] Memory is per tile whichever layer you use: about 190 bytes of JS heap per cell, because the map keeps one `Tile` object per cell. 256x256 is about 12 MB; 1024x1024 would be about 190 MB. `generateLayerDataTexture()` rebuilds the whole texture: about 0.5 ms at 256x256 and 4 ms at 512x512 (one desktop CPU). The documented 4096x4096 limit would need gigabytes, so stream chunks.
- [general] Choose GPU for dense, orthogonal, single-tileset ground in layers up to about 256x256 that change in batches. Choose CPU for sparse content, per-tile tint, rotated tiles, several tilesets, other orientations, a Canvas fallback, or edits every frame.

## Properties and objects

- [documented] Tiled custom properties arrive as `tileset.tileProperties[localId]` and `tile.properties`; `layer.setCollisionByProperty({ collides: true })` reads them. Tile `type` and collision shapes are in `tileset.tileData`. A procedural map has none, so keep your own table keyed by tile index.
- [documented] `map.getObjectLayer(name).objects` returns raw objects (`id`, `name`, `type`, `x`, `y`, `width`, `height`, shape flags, `properties` as Tiled's array). `createFromObjects(layer, { gid | id | name | type, classType, key, frame, container })` builds sprites and converts Tiled's bottom-left tile-object origin (`Tilemap.js#createFromObjects`).
- [documented] Object properties are copied onto the sprite: a property named like an existing field (`depth`, `alpha`, `visible`, `x`) overwrites that field and any other goes to `sprite.setData` (`ObjectHelper.js#setFromJSON`). Name Tiled properties with a prefix to stay out of the way.
- [tested] `sortByY` is read from the config array itself, so `createFromObjects('o', { sortByY: true })` does nothing. Sort `getObjectLayer(name).objects` yourself before the call.

## Editing at runtime

- [tested] One `LayerData` takes one layer: a second `createLayer` for the same layer returns null (with a console warning). A pooled view must rewrite its tiles (`putTilesAt`, `fill`) or be destroyed before another view is made from the same data.
- [documented] A GPU layer does not redraw on `putTileAt`; batch your edits and call `generateLayerDataTexture()` once per frame. Each call makes a new data texture and leaks the old GL wrapper (gotcha 13 in [phaser-rendering](../../phaser-rendering/references/phaser-4-webgl-context-gotchas.md)).
- [general] Keep GPU layers chunk sized (32x32 regenerates in about 0.1 ms) and repaint a tile and its eight neighbours when a blend overlay depends on neighbours.
- [general] Tile collision reads the layer's own position, not its container's, so a GPU layer parked at (0, 0) in a chunk Container needs another collision source; the options are in [phaser-physics](../../phaser-physics/references/tilemap-collision.md).

## Verify

- [general] Read `layer.tilesDrawn` and `tilesTotal` on a CPU layer to prove culling, and one pixel at a tile whose index you know to prove the right layer is on top ([verifying](../../phaser-verification/references/verifying-on-a-gpu.md)). Assert `map.layers.length` after loading Tiled JSON, because a skipped layer is silent.
