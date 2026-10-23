# Verifying a Phaser game: assertions and the harness

What to assert, mutation proof, the debugging harness and reading pixels in the page. Index: [verifying-on-a-gpu.md](verifying-on-a-gpu.md).

## What to assert

1. [general] **A clean console** (errors and warnings) and **no page errors**.
2. [general] **Pixel colours, not "not black".** Teleport the player to a place whose terrain you know (a dark
   paved area, a lake) and assert the share of pixels in a colour range. A "not black" test passed while a particle overlay covered the
   whole terrain.
3. [general] **Every visible chunk renders**, with a camera parked on a chunk corner so four chunks are visible.
4. [general] **Pooling and streaming**: walk for several seconds and assert the number of containers or views stays bounded.
5. [general] **Entity views appear and are released** when a creature leaves the camera.
6. [general] **Frame rate and renderer** are recorded, not asserted tightly.
7. [general] **Native GPU resource lifecycle**: for repeated DynamicTexture removal and RenderTexture destruction, require
   `renderer.glTextureWrappers` and framebuffer counts to return to baseline, no additional live `gl.isTexture`
   handles, and balanced native texture creates/deletes. Also compare texture keys and display objects, but keys
   alone miss replaced source wrappers ([gotcha 24](phaser-4-webgl-context-gotchas.md#24-dynamictexture-and-rendertexture-creation-leaves-a-live-gpu-texture-wrapper-behind)).
   Draw to a native RenderTexture and inspect its pixels and on-screen output before destruction, proving the
   retained drawing-context texture still renders. Verify scene/game teardown releases native handles and wrappers.
   Keep these resource checks separate from a sustained memory or complete game acceptance claim.
   Include bare native allocations: Phaser 4.2.1's texture-unit placeholder is outside `glTextureWrappers`
   ([gotcha 25](phaser-4-renderer-destruction-gotchas.md#25-renderer-destruction-leaves-the-texture-unit-sampler-placeholder-live)).
   Instrument texture/framebuffer creation and deletion before Game construction through final destruction,
   covering both WebGL context prototypes; this pin defaults to WebGL 1 even when WebGL 2 is available.
   Record the actual GL version. Preserve and check the live placeholder rather than deleting it immediately.
   Mark every real context-loss epoch as invalidated: those handles are WebGL-freed and cannot support a balanced-delete
   claim. Require balanced creates/deletes and zero valid handles in the final non-invalidated epoch, and zero registered
   LIVE wrappers. Native destruction may retain arrays of dead framebuffer wrappers; their array length is not a live-resource
   count and does not justify clearing native arrays. Verify restored authored pixels, game/canvas removal and native audio closure.
   Keep the exact expected native loss/restore messages separately from unintended browser/GL warnings; retain failed probe
   attempts with their actual cause and source identity, and rerun only the affected checks after a correction.

## Prove the test by mutation

- [general] For each regression test, re-introduce the bug (for example make an overlay layer a GPU layer again), run the test,
  confirm it fails with a clear number (the dark-pixel ratio went from over 0.08 to 0), and restore the fix.

## Debugging harness (small scripts worth keeping)

- [general] A script that starts the game, optionally runs an expression, screenshots, and prints the renderer string, fps and
  console errors.
- [general] A script that teleports the player to a named place (a biome interior, a distant landmark) and screenshots it. Chunks are generated on
  demand, so this reaches far terrain in seconds.
- [general] A **pixel check** that finds a tile whose data is known, reads the screenshot pixel there, then toggles layers one at a
  time and reads it again. That is what found an overlay bug: the baseline colour, ground plus overlay, ground plus
  a second overlay.
- [general] Pass JavaScript through `page.evaluate` as one line without `//` comments (joining lines turns the rest into a comment).

See `examples/web/phaser-probes` for generic versions. For a whole runnable harness (debug API, manual loop, condition waits, no-sleeps guard, GPU smoke spec, CI workflow) copy `examples/web/harness`.

## Gotchas in the harness itself

- [general] Teleporting a long way and screenshotting after a fixed wait can be flaky on the first frame; wait for chunks to bind.
- [general] At zoom 3, tile (8, 8) is 384 px from the origin; an edit you cannot see may simply be off screen.
- [general] Day and night multiply tints change pixel colours; set the clock to noon before sampling colours.

## Read pixels inside the page: `renderer.snapshotPixel`

A Playwright screenshot is not the only way to read the screen. In the page, `game.renderer.snapshotPixel(x, y, cb)` queues a read that is
fulfilled at the end of the next rendered frame, so a probe can build a tiny object, run a frame and read a colour in one script:

```ts
const px = (wx: number, wy: number) => new Promise<{ red: number; green: number; blue: number }>((res) => {
  game.renderer.snapshotPixel(Math.round((wx - cam.worldView.x) * cam.zoom), Math.round((wy - cam.worldView.y) * cam.zoom), res);
  stepFrame();                                     // in a manual loop: game.step(t, 0)
});
```

Each Phaser behaviour claim in these references can be reduced to such a probe. Two examples that decide real designs (both pass on 4.2.1;
if one starts failing after an upgrade, the workaround it justifies can be deleted):

- [general] GPU layer at `x = 60` draws at `120`: build a 4x4 GPU layer of a known tile at `(60, 0)`, read a pixel at world x 70 (unchanged) and x 170 (now
  the tile colour); put the same layer at `(0, 0)` inside a container at `(60, 0)` and the colours swap to the correct ones.
- [general] An "empty" (`-1`) tile in a GPU layer is the tileset's top-left pixel: an all-empty layer over a sheet whose first pixel is opaque paints that
  colour; over a sheet whose first cell is transparent it paints nothing.

Runnable: the [harness smoke spec](../../../examples/web/harness/tests/smoke.spec.mjs) reads known colours at known places and asserts the renderer.
