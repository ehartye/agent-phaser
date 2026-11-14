# Cost of content: texture memory and objects submitted (Phaser 4.2.1)

Frame time is one cost of content. Two others stay invisible on a development machine, and both are counted, not timed, so a software renderer in CI can enforce them. Put them in the first browser spec of a game and run them again whenever content grows: more kinds of creature, a bigger area, a second level, "three times the enemies". Check ids are from the [content-cost probe](../../../examples/web/phaser-probes/phaser-verification-content-cost.mjs).

## The two checks

| Check | Counts | Fails when | Fix |
| --- | --- | --- | --- |
| Texture memory: [`texture-memory.mjs`](../scripts/assets/texture-memory.mjs) | `width x height x 4` over `game.textures.list`, or over the PNG headers of a folder | the sum is over the budget you measured | load per area and release on leaving ([texture memory](../../engine-phaser/references/texture-memory.md)) |
| View census: [`view-census.mjs`](../scripts/assets/view-census.mjs) | per camera, objects submitted against objects in view, near it and far from it | most of what a camera is handed is far from its view | file objects by chunk as you build and hide far chunks ([building a level](../../phaser-worlds/references/building-a-level.md)) |

- [tested] Both in-page functions are self-contained, so a spec runs them without the game importing anything: ``page.evaluate(`(${measureTextures})(window.__game)`)`` and the same for `viewCensus`. The probe evaluates their source inside a Phaser 4.2.1 page exactly this way.
- [general] Run both after the game has reached its heaviest state: the largest area loaded, and the camera at the far corner of it, since a flat world looks fine from where it starts.

## Texture memory

- [tested] `measureTextures(game)` returns `{ bytes, count, sources, largest, textures }`, largest first; a multi-page texture is the sum of its pages. The sum grew by exactly `width x height x 4` per loaded image and fell by the same on `textures.remove` (`texture-sum-grows-by-width-x-height-x-4-per-load`, `texture-remove-gives-the-bytes-and-the-gl-texture-back`).
- [tested] `checkTextureBudget(report, budgetBytes)` returns `{ ok, overBytes, message }` and the message names the largest texture (`texture-budget-check-fails-over-the-budget-and-names-the-largest`).
- [tested] `node skills/phaser-verification/scripts/assets/texture-memory.mjs <folder> [--budget-mb <n>] [--top <n>] [--json]` needs no browser: it sums PNG header sizes, prints the largest files with their file size beside their texture size, and exits 1 over the budget or on an unreadable PNG (`node --test tests/phaser-texture-memory.test.mjs`). The offline sum equalled the loaded sum (`texture-offline-png-header-sum-equals-the-loaded-sum`).
- [general] The sum is a floor, not the page's memory: it leaves out mipmaps, render targets, decoded source images, audio and the JavaScript heap. There is no default budget, because no browser publishes a limit and the one a phone enforces depends on the device and on what else it is running; the evidence and the way to measure your own are in [texture memory](../../engine-phaser/references/texture-memory.md).

## View census

- [tested] `viewCensus(game, { margin })` counts, for each camera of each active scene, the leaf objects that would be drawn (visible, every ancestor visible, not ignored by that camera) and sorts them by their bounds: `inView`, `nearView` (inside the view grown by `margin` views on each side, default 1) and `far`. Its `submitted` equalled the runs of the renderer's image transformer in a flat world, a chunk-hidden world and after a camera move (`census-submitted-equals-what-the-image-transformer-runs-on`).
- [tested] 900 props added flat to a 3000 x 3000 world were all submitted through a 400 x 300 view: 12 in view, 852 far. Filed by chunk with far chunks hidden, 30 were submitted and none was far (`census-a-flat-world-submits-everything-and-most-of-it-is-far`, `chunk-visibility-brings-the-submitted-count-down-to-the-ring`).
- [general] `checkViewCensus(report, { maxFarRatio, minSubmitted })` fails a camera handed at least `minSubmitted` objects with more than `maxFarRatio` of them far. The defaults (0.25 of at least 200) are a starting point chosen so that a keep-alive ring passes and a flat world fails; they are not a measured frame cost. Objects without bounds (emitters, Graphics, tile layers) and objects pinned to the screen are reported as `unmeasured`, never as far (`node --test tests/phaser-view-census.test.mjs`).
- [general] The census counts objects, not milliseconds. One game submitted 1,772 objects with 237 on screen outdoors, and 466 with 79 in a dungeon, through a phone-sized view; what that cost on a phone was never measured. Time it on the target device ([performance](performance.md)) before promising a frame-rate gain. Hiding far objects is still the right default: it is nearly free to build in, and it removes work that grows with the size of the level instead of the size of the screen.

## Costing a content increase

- [general] A content increase spends three budgets, and a per-item frame-time table ([profiling method](profiling-method.md)) covers only one. Beside milliseconds, price each new kind of thing in texture memory (its sheet's `width x height x 4`, held for as long as it can appear) and in objects submitted per frame wherever the camera is.
- [general] A plan that triples the kinds of thing in a game can leave the frame time flat and triple the textures held. State all three numbers before and after, at 1.0x and at the planned scale.

## Verify

- [tested] `node examples/web/phaser-probes/phaser-verification-content-cost.mjs <host project>` passed its 11 checks on Phaser 4.2.1 with a software renderer. It proves the counters agree with the engine; it does not measure any device's memory limit or frame time.
