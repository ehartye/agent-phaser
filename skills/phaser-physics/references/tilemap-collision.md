# Tilemap collision in Phaser 4.2.1

Make tiles solid, and keep them solid when a layer is a GPU layer, is edited at run time, sits in a container, or is one chunk of a streamed world. Drawing and streaming are in [tilemaps and terrain](../../phaser-worlds/references/tilemaps-and-terrain.md); GPU layer drawing bugs are in [tilemap gotchas](../../phaser-worlds/references/phaser-4-tilemap-gotchas.md). Probe: `examples/web/phaser-probes/phaser-physics-tilemap.mjs` (`node phaser-physics-tilemap.mjs <host project>`; WebGL, software is enough).

## Make tiles solid

| Source of truth | Call | Registers the index for later `putTileAt` |
| --- | --- | --- |
| a list of tile indexes | `setCollision([1, 2])`, `setCollisionBetween(a, b)` | yes |
| everything except some indexes | `setCollisionByExclusion([-1])` | only indexes present at the call |
| a Tiled custom property | `setCollisionByProperty({ collides: true })` | no |
| Tiled collision-editor shapes | `setCollisionFromCollisionGroup()` | no |

- [documented] Each call walks the whole layer and, by default, recomputes every tile's faces (`src/tilemaps/components/SetCollision.js`, `SetCollisionByProperty.js`). Call them once at load, not per edit.
- [documented] `setCollisionFromCollisionGroup` only marks a tile solid when it has a shape; Arcade still collides with the whole tile box. Matter uses the shapes (`MatterTileBody.js`).
- [tested] A `TilemapGPULayer` collides like a CPU layer: it extends `TilemapLayerBase`, which owns `isTilemap`, the collision calls and the tile data (`src/tilemaps/TilemapGPULayer.js`, `TilemapLayerBase.js`). A body stopped at the expected wall on a GPU layer, and a `putTileAt` on it collided before `generateLayerDataTexture()` was called; that call only matters for drawing.

## Limits of Arcade tile collision

- [documented] Against tiles every body is a rectangle, a circle body included, and only a tile's exposed faces collide (`TileIntersectsBody.js`, `SeparateTile.js`). No slope code exists in `src/physics/arcade`.
- [documented] `TileCheckX.js` drops an overlap larger than `tileBias`, default 16 px (config `arcade: { tileBias }`, runtime `world.TILE_BIAS`).
- [tested] So a step longer than `tileBias` passes through even a three-tile wall: a 10 px step never did; a 40 px step (2400 px/s) passed in 15 of 16 start phases at 16, and in none at 64.
- [general] Set `tileBias` to at least the longest step in px. The doc comment's "similar to the tile size" (`World.js`) holds only while no body moves more than a tile per step; a bias below the step may still leak for some phases.
- [tested] `world.collideTiles(sprite, tiles)` treats every face as solid, so a body sliding on a flat floor snagged at a tile seam and stopped (x 208, vx 0), where the layer collider slid on (x 260, vx 120). Use `physics.add.collider(sprite, layer)` for ground.
- [general] For slopes use a height-field in the sim, Matter polygons from the map's shapes, or an object layer of polygons; none of these exist in Arcade.

## Edit tiles at run time

- [tested] `putTileAt` makes a tile solid only if its index is in `layer.layer.collideIndexes`. After `setCollisionByProperty` that list is empty, so a placed wall tile was not solid, and the property copied onto the tile did not help. `setCollision([1])` registered the index and `setCollisionByExclusion([-1])` registered only the indexes already in the layer (`src/tilemaps/components/PutTileAt.js`).
- [tested] The edit that works for any collision source sets the tile itself and refreshes faces nearby:

```js
const t = layer.putTileAt(index, x, y, false);
t.setCollision(solid, solid, solid, solid, false);
layer.calculateFacesWithin(x - 1, y - 1, 3, 3);        // not the whole layer
```

- [documented] On a GPU layer remove with `removeTileAt(x, y, false)`; the default leaves `null` and the next `generateLayerDataTexture()` throws (see the tilemap gotchas, gotcha 2).

## Layers, containers and chunked worlds

- [tested] Tile collision uses the layer's own `x`, `y`, scale and scroll factor, never its parent container: a layer inside a container at x 1000 still collided at its local position (stop at 66, not 1066). The `TileToWorldX.js` source shows `layer.x + camera.scrollX * (1 - scrollFactorX)`. The usual render recipe (GPU layers at 0,0 inside chunk containers) therefore leaves every chunk's collision at the origin.
- [general] Keep collision layers at scroll factor 1, or a moving camera shifts them.
- [tested] A collision-only CPU layer works where you place it, hidden: `setVisible(false)` at x 1000 stopped the body at 1066.
- [tested] A collider on a destroyed layer throws every step (`Cannot read properties of undefined (reading 'tileWidth')`). Destroy the `Collider` first when you release a pooled chunk.

Options for collision in a streamed world:

- [general] **A. The sim owns it** (`scripts/assets/grid-sweep.mjs` over the chunk arrays). Time: a day. Risk: low, it is testable in Node. Complexity: the view only draws. Best practice: the headless-sim rule in [architecture](../../engine-phaser/references/architecture.md). Maintainability: best.
- [general] **B. A hidden CPU collision layer per active chunk**, at the chunk's real position, beside the drawn GPU layer. Time: an hour. Risk: Tile objects for every cell and a collider to destroy per chunk. Complexity: two copies of the chunk to keep in step on edits. Best practice: works, bypasses the container problem. Maintainability: moderate.
- [general] **C. Merged static bodies per chunk** (greedy rectangles from solid cells, world coordinates). Time: a few hours. Risk: rebuild on edits, body count. Complexity: a merge routine and `refreshBody`. Best practice: fine for fixed levels. Maintainability: moderate.

## One-way platforms, callbacks and overlaps

- [tested] `layer.forEachTile((t) => t.setCollision(false, false, true, false))` makes tiles solid on top only: a body rising from below passed through and one falling from above landed (y 50).
- [tested] A `setTileIndexCallback` callback that returns `true` cancels the collision and the body walks through. `ProcessTileCallbacks.js` returns `!callback(...)`, so [documented] the same holds for `setTileLocationCallback` and `tile.collisionCallback`. Callbacks run only while a collider or overlap joins that body and layer.
- [tested] `physics.add.overlap(sprite, layer)` calls back for every tile in reach, empty `-1` tiles included (4 callbacks over an empty area), because overlap passes no filter (`World.js#collideSpriteVsTilemapLayer`). Filter in the process callback: `(s, tile) => tile.index > -1 && tile.properties.trigger`.
