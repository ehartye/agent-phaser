# Building a level in Phaser 4.2.1: hide by position from the first loop

Read this before you write the function that creates a level's or an area's display objects, whatever it is made of: a tilemap, or a floor image with loose Images for walls, plants, props and creatures, top-down or isometric. The world does not have to be a tilemap, be streamed or be large for this to apply. Grouping, depth and parallax are in [world structure and streaming](world-streaming-and-layers.md). The `chunk-visibility-` and `census-` check ids are from the [content-cost probe](../../../examples/web/phaser-probes/phaser-verification-content-cost.mjs).

## Why at build time

- [tested] Nothing culls Images or Sprites by position: an object far off screen is submitted and transformed every frame until something hides it, and every extra camera repeats the pass ([cameras](cameras.md)). 900 props added flat to a 3000 x 3000 world were all transformed through a 400 x 300 view with 12 of them in it (`census-a-flat-world-submits-everything-and-most-of-it-is-far`).
- [general] Filing an object under a chunk costs one call in the loop that creates it. Adding it afterwards means finding every place that creates, moves or destroys a world object, so it tends not to happen: a desktop never shows the cost.
- [general] One isometric game drew each area as a baked floor image plus individual Images for wall pieces, standing plants, props and creatures, created by one build function and added flat to the scene. Nothing was ever hidden by position. Through a phone-sized landscape view (750 by 342 world pixels) the outdoor area submitted 1,772 objects a frame with 237 on screen, about 87% of them wasted, and a dungeon floor 466 with 79. The frame cost on a phone was not measured.

## The steps

1. [general] Choose a chunk size near half the view in world pixels and a margin of one chunk, or more when your tallest sprite is taller than a chunk: objects are filed by their anchor, and a tall wall anchored below the view must still be drawn.
2. [general] In the build loop, hand every object to the bucket as you create it: `chunks.add(scene.add.image(x, y, key))`. Use the position you draw at; for an isometric area that is the projected position, not the grid cell.
3. [general] Call `chunks.update(view)` once after building and once per frame, with a rectangle around the follow target or `camera.worldView` (a frame stale, which the margin covers). Call `chunks.move(sprite)` when something has walked, `chunks.remove(sprite)` before destroying it, and `chunks.clear()` when the area is torn down.
4. [general] Put the view census in the first browser spec with a far-object limit, so a later builder that forgets step 2 fails a test instead of a phone ([cost of content](../../phaser-verification/references/content-cost.md)).

## The helper

- [tested] [`createChunkVisibility({ chunkWidth, chunkHeight, margin, apply })`](../scripts/assets/chunk-visibility.mjs) is a dependency-free module with no Phaser import. After `add` for each of the 900 props and one `update`, 30 were transformed per frame instead of 900 (the view's chunks plus one on every side) and the census found none far (`chunk-visibility-brings-the-submitted-count-down-to-the-ring`).
- [tested] It leaves objects where they are in the display list, so depth sorting between a walker and a prop in different chunks is unchanged (`chunk-visibility-leaves-the-display-list-order-alone`).
- [tested] An `update` whose chunk range has not changed writes nothing, and crossing a chunk edge writes only the chunks that entered or left: after a jump of 1,500 pixels the submitted count was again the ring, 42 objects (`chunk-visibility-follows-the-camera-and-writes-nothing-inside-a-chunk`; `node --test tests/phaser-worlds-chunk-visibility.test.mjs`).
- [general] `apply(object, visible)` defaults to `object.setVisible(visible)`. Pass `(o, v) => o.setVisible(v).setActive(v)` to stop far animations too; keep the logic of a hidden creature in the simulation, not in its sprite.

## Bucket or Container

- [general] Loose sprites that depth-sort against each other (isometric and top-down y-sorting): the bucket, with the objects flat in the scene or in one Layer. A Container per chunk would stop a walker and a prop in different chunks from sorting against each other, which is why "one Container per chunk" does not fit such a world.
- [general] Chunk content that sorts only within itself (tile layers, ground decals, a chunk's baked overlay): one Container per chunk and one `setVisible` per chunk ([world structure](world-streaming-and-layers.md)).
- [general] A single baked floor image is one object however large it is; split it only when its texture is too big to hold ([texture memory](../../engine-phaser/references/texture-memory.md)).

## Verify

- [tested] `viewCensus(game)` from [view-census.mjs](../../phaser-verification/scripts/assets/view-census.mjs) reports objects submitted, in view, near and far per camera, and its submitted count equalled the renderer's transformer runs (`census-submitted-equals-what-the-image-transformer-runs-on`). Run `checkViewCensus` after the camera has travelled to the far corner of the largest area.
