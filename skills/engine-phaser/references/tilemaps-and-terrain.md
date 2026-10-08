# Tilemaps and procedural terrain in Phaser 4

How to draw a large, editable, procedurally generated tile world. Read [gotchas](phaser-4-gotchas.md) first: two GPU
layer bugs decide the layer design.

## Layer plan per chunk

A chunk is 32x32 tiles at 16 px. One pooled view owns these layers:

| Layer | Type | Why |
| --- | --- | --- |
| ground | `TilemapGPULayer` | dense: every tile set, one quad per chunk, one data-texture upload per edit batch |
| overlay 0, overlay 1 | CPU `TilemapLayer` | sparse; a GPU layer paints empty tiles as tile 0 |
| floor | CPU | sparse |
| objects (cover, plants, walls) | CPU | sparse, per-tile alpha or tint |
| roof | CPU, in its own container | must draw above entities, so it needs a different depth |

All GPU layers stay at (0, 0) and are positioned by a parent `Container` (see gotcha 1). Put the container at
`chunk * 512` world pixels.

## Pooling and streaming

- Visible chunk range from `camera.worldView` plus a margin of one chunk.
- Bind a pooled view to each wanted chunk; release views that leave. Scrolling then allocates nothing. Bind through a distance-sorted queue
  with a per-frame time budget, not the whole ring in one frame ([performance](performance.md)).
- On a tile edit, repaint that tile **and its eight neighbours** (blend overlays depend on neighbours) and flush the
  GPU layer once per frame.
- Things that change without an event (moisture, growth) are reconciled on a timer over the sim's *active* tile set for
  visible chunks, so cost scales with farmland, not map size.
- A level change releases every bound view, because the same chunk coordinates mean different chunks.

## Frame names to indices

A gapless agent-sprites sheet on a regular grid doubles as the tileset image: a frame's tile index is its row-major
cell position (`row * columns + column`, columns = sheet width / tile size). Build a `name -> index` map from the
texture's frames and keep **one** function that maps sim tile state to frame names (a `TileComposer`). It is pure, so it
is unit tested without a renderer, and swapping art means changing names in one file.

Never let the composer hand a GPU ground layer `-1`: fall back to a safe tile.

## Blending between materials (encroachment overlays)

Draw every tile as its own material, then overlay each higher-priority neighbour material onto it.

- The mask has one bit per neighbour that *is* the overlay material (N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128).
- A diagonal bit counts only when both adjacent edge bits are clear; that leaves exactly 47 masks (16+16+8+2+4+1).
  Unit-test this: enumerate 0..255, normalise, count distinct values.
- Overlay tiles of the same material must seam across every neighbourhood; agent-sprites' `terrain-overlay` recipe
  guarantees that and names frames `<material>_<mask>_<variant>`.
- Keep a priority table (water lowest so shores read as land over water; hard surfaces highest). At most two overlay
  layers per tile; keep the highest-priority two.
- Choose the per-tile variant with a hash of the tile coordinates so repainting never reshuffles the ground.

## Animated tiles (water)

Register tile animations on the **tileset** (`tileData`), not per layer; the GPU layer animates them in the shader, so
a whole lake animates for one data upload. Remember `animationDuration` (gotcha 3). Have every water tile use frame 0.

More than one animation per tileset needs the index-map fix (gotcha 10), and only GPU layers animate. A sparse animated layer
(plants, glow, drips) is a GPU layer over a sheet whose cell 0 is transparent (gotcha 2 refinement). Give a plant field
phase-shifted copies of one loop so it does not sway in lockstep.

## Ground variety without a stored layer

Variety that needs no sim data can be a second sparse GPU ground layer between the base ground and the blend overlays, holding
seamless macro patterns picked by `(x mod P, y mod P)` and a low-frequency noise field. Give a flavoured tile a priority a hair
below its parent material so the parent's existing 47-mask overlays encroach on the patch border: ragged edges for free, no
per-flavour transition art. Derive street furniture (lane dashes, crossings, curbs) from the neighbouring ground ids instead of
placing it, so any generator that paints asphalt gets markings.

## Procedural terrain generation notes

- Regions must come from coherent noise fields, not per-tile randomness: single random gravel tiles in dust render as
  speckle. Use a broad field and a detail field, threshold them into patches, and reserve per-tile randomness for rare
  scatter.
- Measure, do not guess: write a small script that prints the share of each ground type and biome over a ring of the
  world for several seeds, and tune thresholds against targets. A first pass had hotzone at 59% of the far world.
- Give the start a safe, legible neighbourhood (a radius with forced plain terrain) and a guaranteed water source.
- Make cities structured: a street grid with broken asphalt and concrete foundations reads as ruins; noise alone does
  not.
