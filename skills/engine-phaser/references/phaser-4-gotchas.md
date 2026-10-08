# Phaser 4.2.1 gotchas

Each entry: symptom, cause, evidence, workaround. The original Fallow Valley entries were observed on Phaser 4.2.1
(published 2026-07-09), in WebGL on an NVIDIA GPU through ANGLE/D3D11; their upstream `master` source was checked on
2026-10-05 and their suggested fixes are ours. Later entries identify their own bounded native evidence and related
upstream reports.

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

**Refinement (read from `TilemapGPULayer-frag.js`).** The layer data does mark `-1` as empty, but the shader's empty branch
returns texel coordinate `(0, 0)` of the tileset for the whole quad, so the tile is filled with the colour of the sheet's
**top-left pixel**, not a lookup of tile 0's art. That makes a sparse GPU layer possible: make cell 0 of the tileset fully
transparent (an explicit `empty` cell first in the sheet) and "empty" becomes transparent. Sheets whose first cell is opaque
(a terrain sheet starting with dust) still need full layers. See gotcha 10 for what sparse GPU layers are good for.

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

## 8. A Container's alpha does not reach the CPU tilemap layers inside it

`container.setAlpha(0.25)` changed nothing on screen when the container held a `TilemapLayer`; the scene graph said 0.25
and the pixel was unchanged (a roof fade was silently broken). Set alpha on the layer itself. Verify fades with a pixel
read of a tile with the effect on and off.

## 9. Lighting, camera filters and render textures (measured on 4.2.1)

- `setLighting(true)` works on CPU tilemap layers, sprites and images. Falloff is smooth and additive (easy to overexpose),
  there is no occlusion, and it is per-object opt-in, which is awkward with pooled chunk layers. About 0.9 ms for 8 lights at
  1280x720. For pixel-art bands, wall shadows or a grade, a world-locked light map is more controllable: a texture with one
  texel per world pixel (`RenderTexture` filled with ambient, ADD `stamp` pools; or a CPU canvas for occlusion), drawn over
  the world with MULTIPLY and NEAREST filtering.
- Camera filters (`camera.filters.internal.addColorMatrix()`, `addDisplacement(key, x, y)`) keep pixel art crisp when the game
  is `pixelArt: true` (compare distinct colour counts with the filter on and off), cost nothing while `setActive(false)`, and
  only affect that camera, so a UI scene is untouched. `ColorMatrix.saturate(-1)` is full grayscale, `0` is identity.
- `RenderTexture`/`DynamicTexture` commands (`fill`, `stamp`) are queued and run (and are cleared) only on `render()`. Never
  queue without rendering.
- To measure cost instead of vsync, launch Chromium with `--disable-gpu-vsync --disable-frame-rate-limit` and read
  `game.loop.actualFps`.

## 10. Tile animations: GPU layers only, and the second animation plays the wrong tiles

**Symptom.** After registering several tile animations (swaying plants, pulsing crystals), a row of one plant draws tiles of
other plants (wildflowers showed glowing mushrooms and dry grass). The first animation registered (our water) was always right.
CPU `TilemapLayer`s never animate at all.

**Cause.** Only `TilemapGPULayer` animates tiles (`tileData[i].animation`, read by `Tileset.createAnimationDataTexture`). That
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

**Also.** To desynchronise a field of animated tiles (no per-tile phase in the shader), register one animation per phase: the
same frames started a quarter apart. Phase tiles need their own cells in the sheet because `tileData` is keyed by tile index.
Put sparse animated content (plants, glow, drips) in its own sparse GPU layer (gotcha 2 refinement); the CPU layers stay static.

## 11. Restarting scenes: a loading scene ignores `start`, and the sim must change in `init`, not before

Found building a title screen that plays the real world scene behind its menu, then starts a game over it (Phaser 4.2.1).

* `scene.start('world')` on a scene that is **running, paused or sleeping** shuts it down and restarts it (`init`, `preload`, `create`
  again). On a scene that is **starting, loading or creating** (statuses START to CREATING) `SceneManager.start` returns without doing
  anything, so the data you passed never arrives. Gate a start on `scene.isActive(key)` and queue it for the first frame it is true.
* Do not "fix" that with `stop` then `start`: stopping a scene mid-load leaves its queued files in the loader, and the second load
  logs `Texture key already in use` for every atlas. Load the scene's assets in an earlier scene instead (one function that queues
  them, called from the preload scene; the loader skips keys already cached, so the scene's own `preload` calling it again is free).
* If a global object holds the game state (our `SimHost` plugin), do **not** swap it in the scene that decides to start. The running
  scene keeps drawing for the rest of that frame and the next, one world's views with the other world's entities. Pass a `boot`
  callback in the start data and call it first thing in the restarted scene's `init`.
* A modal or panel that rebuilds its own window (a changed row, a new page) must re-centre it: only the stack that opened it knew
  where it belonged, so the rebuilt window appeared at (0, 0). Put placement in the base class `layout`.

## 12. Whole-pixel screen shake

`camera.shake` offsets by fractions of a pixel, which smears pixel art. Use the camera's follow offset instead: every ~33 ms
pick an integer offset (a hash of the step index, so it is repeatable), let the amplitude fall in whole steps to exactly 0, and set
`camera.setLerp(1, 1)` while it rings so the offset lands on the frame it is set (restore the lerp after). Assert in a test that
every sampled offset is an integer and that the last sample is `(0, 0)`. A hit stop is the same idea in time: skip the fixed-step
advance for 60 to 110 ms and keep the last interpolation alpha, never touching the sim's clock.
## 13. `generateLayerDataTexture()` leaves a dead GL wrapper, and that breaks WebGL context restore

`TilemapGPULayer.generateLayerDataTexture()` replaces its data texture with `layerDataTexture.destroy()`, which frees the GL
texture but leaves the wrapper in `renderer.glTextureWrappers` (its `renderer` is null). Each regeneration leaks one, and when the
browser restores a lost context Phaser calls `createResource()` on every wrapper and throws
`Cannot read properties of null (reading 'gl')`: the renderer never comes back. The layer's own `destroy()` also never frees the
data texture. Workaround: before regenerating, `renderer.deleteTexture(layer.layerDataTexture)` and null the field; do the same
when you destroy a chunk. Test: count `renderer.glTextureWrappers.filter(w => w.renderer === null)` (expect 0) and run
`gl.getExtension('WEBGL_lose_context').loseContext()` then `restoreContext()` and assert the world draws again.

## 14. Scene lifecycle: what survives stop/start

`Systems.shutdown()` removes only the TRANSITION_* listeners and emits SHUTDOWN. A scene's own `events` emitter keeps every other
listener (a `scene.events.on(WAKE)` in `create()` stacks one per visit); game-wide emitters (`game.events`, `scale`, `registry.events`),
the global texture manager and the DOM obviously outlive the scene. The scene's input/keyboard plugins and display list do clean
up. Also: the Scene *object* is reused, so a `WeakMap<Scene, Pool>` hands out images that were destroyed with the display list,
field initialisers run once per Scene object (reset accumulators in `init()`), and canvas textures you made are yours to remove.
Remove everything in one SHUTDOWN handler. Guard it with a browser spec that restarts the scene ten times and requires listener
counts per event name (`emitter.eventNames()` / `listenerCount`), texture count and display-object count not to grow, plus a static
test that a file subscribing to a long-lived emitter also unsubscribes. Prove it red by mutation.

## 15. Focus, visibility, context loss, and unused audio

Phaser pauses its loop in a hidden tab (and resets the delta on return) but keeps running when the window only loses focus, so a
simulation plays on unseen: listen once per game for `Core.Events.BLUR/FOCUS/HIDDEN/VISIBLE` and stop stepping. On
`renderer.on(Renderer.Events.LOSE_WEBGL)` Phaser disables the renderer but your update loop still runs, and creating a GL
resource then throws (`Framebuffer Unsupported`): hold the frame until `RESTORE_WEBGL`. Dynamic textures (RenderTexture) must be
redrawn after a restore. If sound comes from another engine, set `audio: { noAudio: true }` or Phaser builds an unused AudioContext.

## How these were found (do it this way)

1. Build the smallest standalone version in the live scene (`scene.make.tilemap({ data })` plus a layer inside a
   container) and compare with the real pipeline.
2. Read a screenshot pixel at a tile whose data you know, then toggle the other layers one at a time and read again.
3. Print the layer data and compare with the pixel: that separates a data bug from a render bug.
4. Read Phaser's source for the render node (`src/renderer/webgl/renderNodes/submitter/`) once you have a suspect.
5. Re-introduce the bug and confirm the regression test fails.

## 16. `emitter.setFrequency()` resets the flow counter, so calling it every frame starves the emitter

`ParticleEmitter.setFrequency(f)` sets `frequency` **and** `flowCounter = f` (`src/gameobjects/particles/ParticleEmitter.js#L1727`); each
update does `flowCounter -= delta` and emits while it is `<= 0` (`#L2897`). If the wanted rate depends on something that changes (a camera
size) and you call `setFrequency` every frame, a frame (16.7 ms) is shorter than the interval (21.7 ms), the counter never reaches 0 and
nothing is ever emitted, while the emitter reports `emitting: true` and the right frequency. Change it only when the wanted rate has moved by
a threshold. Reproduce: call `setFrequency(emitter.frequency)` in a loop of frames and watch `getAliveParticleCount()` drain to 0, then recover
once you stop.

A death zone is anything with `contains(x, y)`: `emitter.addDeathZone({ type: 'onEnter', source: { contains: (x, y) => underRoof(x, y) } })`.
`DeathZone.willKill` tests `particle.worldPosition` every update (`src/gameobjects/particles/zones/DeathZone.js#L63`), so a function over your
own world data makes weather stop at roofs with no per-particle allocation.

## 17. The `delta` your scene receives is smoothed

`TimeStep.step` hands scenes `smoothDelta(delta)` when `smoothStep` is true (the default): the mean of the last ten deltas, and any delta above
`1000 / minFps` replaced by the last sane value (`src/core/TimeStep.js#L570`). Accumulators are fine with that; code that wants the real frame time
should read `game.loop.rawDelta`. `game.step(time, delta)` bypasses smoothing, so a hand-driven test loop and the live loop differ slightly: test the
pure stepper with raw numbers and trust the game loop for the rest.

## 18. CPU tilemap layers inside a positioned container are culled as if the container were at the origin

`CullBounds` subtracts the layer's *own* `x, y` from `camera.worldView` and never looks at a parent container
(`src/tilemaps/components/CullBounds.js#L27`). A layer at (0, 0) inside a container at (2560, 0) is judged to be far from a camera looking
at 2560, so only some of its tiles draw: landmarks, covers and wall pieces vanish at random while others show; a GPU ground layer is
unaffected. `CullTiles` honours `layer.skipCull` by using the whole layer (`src/tilemaps/components/CullTiles.js#L28`), so set
`layer.skipCull = true` on every CPU layer you put in a positioned container and do your own culling at chunk level (hide views that do not
touch the camera). Cost: a visible CPU layer then walks all its tiles every frame, which is why hiding off-screen views and empty layers
matters ([performance](performance.md)). Related: the CPU layer renderer reads `src.alpha` (the layer's own, `src/tilemaps/TilemapLayerWebGLRenderer.js#L50`),
which is why a container's alpha does not reach it (gotcha 8). Test: read the pixel at a landmark tile in a far chunk (yellow hatch handle in the
example), with and without `skipCull`.

## 19. Never destroy and recreate interactive objects in response to input

A "dirty flag, rebuild everything once per tick" UI is lossy for the mouse in two ways. (1) Phaser's click is down plus up on the same object, so a
rebuild between them hands the release to a new object that never saw the press. (2) Phaser adds a new interactive object to the input list in the
scene's PRE_UPDATE, after that frame's queued pointer events are processed, so the frame after a rebuild is deaf: `pointerdown` fires on the scene but
no `gameobjectdown`. Hover is the usual trigger (it sets the dirty flag just before the click), and it costs about 1 click in 20 with Playwright's
instant move, down, up under load. Build zones and buttons once per layout and update them in place (`setLabel`, `setFocused`, `setVisible`); rebuild only
the passive art on state changes. Test it deterministically: `game.loop.sleep()`, `mouse.move`, `mouse.down`, `game.loop.wake()`, wait a few frames,
`mouse.up`; assert the scene's `input._list` is unchanged after state changes. Found in Fallow Valley's wardrobe (`CreatorPanel`: `build()` once, `refresh()` in place).

## 20. Per-plant motion on tilemaps: split the layer by phase, move the parent container

A tilemap layer has no per-tile transform, so "every plant sways by its own phase" cannot be a vertex tweak. What works with no per-tile work and no per-frame
allocation: quantise the phase (four classes of `(tx + (ty >> 1)) mod 4`), keep one **GPU tile layer per class**, route each tile into its class's layer when it is
painted (remember the slot per tile so a tile that changes class leaves the old layer), and put each layer in its own `Container` whose `x` is that class's whole-pixel
offset this frame. Facts measured on 4.2.1:

- Move the **container**, not the layer: a `TilemapGPULayer` applies its own x/y twice (gotcha 1); a nested container composes correctly with the chunk container above it.
- A GPU layer holding no tiles must be `setVisible(false)`, or Phaser still submits a quad for it; keep a live-tile count per layer. Eight extra GPU layers per chunk cost
  31 more draw calls on screen and no measurable CPU time (2.2 ms vs 2.15 ms a frame).
- A mutation behind the sim's back (writing chunk arrays) does not repaint; only change events and a rebind do. In a test, release and rebind the streamer.
- With the sim **paused** the view interpolates `prev` to `player` with alpha 0, so a teleported player is drawn where it was and the camera never arrives: take one tick, run ~30 frames, then pause.
- Gate the effect from the view side only (weather, the view clock, tile coordinates, Reduce motion); never read the sim for time, so frame-stepped tests are exact.
- The whole 16 px tile moves as a unit (crowns slide over a still trunk); a true bend needs a vertex shader on the tilemap layers.

## 21. Reactive companion art on a prop (a level meter): atlas frames owned by the prop's view

Draw a level meter, status pip row or similar as extra atlas-frame images owned by the prop's view: create them lazily, `setFrame` only when the frame name changes, destroy
them in the same pass as the prop image. Author the meter as small pips with the build's outline flag so gaps fill with outline colour (a dark strip, no extra pixels). Detect
lit pips in browser tests by hue, not exact colour (the lighting pass tints the world). `screenOf(tileX, tileY)` already returns the middle of the tile; adding 0.5 puts it half a tile off.
Found in Fallow Valley's troughs (`docs/PHASER-NOTES.md`).

## 22. A Scene object is reused, so state keyed to it survives with destroyed display objects

Besides listeners (gotcha 14): a field initialiser or a `WeakMap<Scene, Pool>` runs once per Scene object, so after a restart the pool still holds images that were destroyed with the display list (invisible shadows in Fallow Valley). Reset such state in `init`/`create` or on `SHUTDOWN`, and write a spec that restarts and then uses it.

## 23. Filter-mask framebuffers delete invalid handles during WebGL context restore

**Symptom and cause.** On pinned npm Phaser 4.2.1, a native `Container`/`Rectangle` with an external `Graphics` filter mask
draws again after actual `WEBGL_lose_context` restoration, but logs `INVALID_OPERATION` for `deleteFramebuffer` and
`deleteRenderbuffer`. `WebGLRenderer.dispatchContextRestored()` recreates wrapper resources while `renderer.contextLost`
is still true. `WebGLFramebufferWrapper.createResource()` first deletes its previous-context framebuffer and owned
renderbuffers, which the browser has already invalidated. A plain scene without the mask does not reproduce these calls.

**Temporary dependency band-aid.** Copy the exact released
[phaser-framebuffer-restore-patch.mjs](../scripts/assets/phaser-framebuffer-restore-patch.mjs) into the consuming project's
scripts directory and invoke it from the existing postinstall after Phaser is installed:

```sh
node scripts/phaser-framebuffer-restore-patch.mjs node_modules/phaser
```

An existing Node postinstall can instead import `patchFramebufferRestore` from that copied module and
`await patchFramebufferRestore(installedPhaserDirectory)`. Import alone has no side effect. It requires exactly package
name `phaser` and version `4.2.1`, and preflights the unique original or corrected native fragment in
`src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js`, `dist/phaser.esm.js` and `dist/phaser.js` before any write.
Unknown, ambiguous, mixed original/corrected states or mixed target newlines fail installation without partial edits.
LF/CRLF and every byte outside the fragment are preserved; repeated installation is idempotent. The helper composes
with the separate audio, gamepad lifecycle and held-input corrections. Keep the consuming project's integrity guards
consistent with the released helper and invalidate any existing bundler dependency cache after correcting its input.

The guard skips invalid previous-context handles during restore, using native `gl.isFramebuffer` validity. It still
deletes live handles recreated during that same restore phase: native renderer resize listeners run before
`contextLost` is cleared, so the flag alone is insufficient. Ordinary live recreation, resize, attachment creation,
canvas use and destroy keep their native behavior. This corrects resource ownership; it does not suppress GL warnings.

**Evidence and limits.** Node tests execute the complete pinned native wrapper and its actual `Class` dependency,
with exact npm source hashes recorded in the fixture. They cover stale and live restore-phase handles, texture versus
renderbuffer ownership, repeat restore/recreate, resize, canvas use, destroy and installer refusal/composition.
A standalone native mask and plain control were also checked on NVIDIA through ANGLE/D3D11, with two actual context
loss/restore cycles, identical nonempty restored pixels, live recreate/resize and teardown. This is bounded evidence
for Phaser 4.2.1 and that GPU/backend, not a claim about every browser or renderer. Remove this band-aid only after an
equivalent reviewed, pinned upstream fix passes both stale-handle restore and live-handle disposal checks.

## 24. DynamicTexture and RenderTexture creation leaves a live GPU texture wrapper behind

**Symptom and cause.** Pinned npm Phaser 4.2.1 creates a TextureSource GL wrapper in the base Texture constructor,
then replaces `frame.source.glTexture` with `this.drawingContext.texture` without disposing the first wrapper.
Removing the DynamicTexture, or destroying its native RenderTexture owner, disposes the replacement while the
original remains registered and live. Texture-manager keys return to baseline, so counting keys alone misses it.
Related primary [report #7379](https://github.com/phaserjs/phaser/issues/7379) and proposed
[upstream fix #7381](https://github.com/phaserjs/phaser/pull/7381) describe this replacement path; their status is not
a substitute for testing the consumed pin.

**Temporary dependency band-aid.** Copy the exact released
[phaser-dynamic-texture-patch.mjs](../scripts/assets/phaser-dynamic-texture-patch.mjs) into the consuming project's
scripts directory and invoke it from the existing postinstall after Phaser is installed:

```sh
node scripts/phaser-dynamic-texture-patch.mjs node_modules/phaser
```

An existing Node postinstall can instead import `patchDynamicTexture` and
`await patchDynamicTexture(installedPhaserDirectory)` from the copied module. Import alone has no side effect.
The helper requires exactly package name `phaser` and version `4.2.1`, and preflights one known native constructor
fragment in `src/textures/DynamicTexture.js`, `dist/phaser.esm.js` and `dist/phaser.js` before any write. Missing,
unknown, ambiguous, mixed original/corrected targets or mixed target newlines fail without partial edits. All targets
must share one original or corrected state and LF/CRLF style. Every outside byte is preserved, and repeated
installation is idempotent. It composes with the separate audio decode, audio visibility, gamepad lifecycle,
held-input and framebuffer restore corrections. Keep the consuming project's integrity guards consistent with the
released helper and invalidate any existing bundler dependency cache after correcting its input.

The correction calls native `renderer.deleteTexture(frame.source.glTexture)` immediately before assignment within
the existing WebGL-only branch. Native DynamicTexture/RenderTexture ownership and APIs remain in charge; this is
an install-time dependency correction, not a game-side runtime shim or warning suppression. Remove this band-aid
only after an equivalent reviewed, pinned upstream fix passes both allocation/disposal and retained-texture pixel
checks.

**Evidence and limits.** The Node fixture stores exact npm 4.2.1 DynamicTexture and Class source hashes and executes
the native constructor and destroy method with minimal external dependency doubles. In an isolated native NVIDIA
RTX 5070 Ti ANGLE/D3D11 probe, eight DynamicTexture removals and eight RenderTexture destructions grew registered
wrappers from 4 to 20 before correction; GL texture counts were 32 creates and 16 deletes, with all sixteen orphans
live. The corrected separate package copy kept wrappers at 4 and balanced 32 creates with 32 deletes. Texture keys,
framebuffers and scene display counts returned to their original state after each cycle. Eight native RenderTexture
draws and their on-screen samples returned expected RGBA `(98, 201, 168, 255)`, preserving the drawing-context
texture. Actual served optimizer code and source map were bound to the corrected ESM; native browser warnings and
errors were zero, and scene/game resources, owned browser and server were closed. This is bounded pin/backend
evidence, not full game acceptance, sustained memory measurement, context recovery or phone certification.

## 25. Renderer destruction leaves the texture-unit sampler placeholder live

**Symptom and cause.** npm Phaser 4.2.1's native `WebGLTextureUnitsWrapper.init()` creates one bare `tempTexture`,
binds it to every texture unit and uploads a blue 1x1 pixel. The source states that the placeholder prevents MacOS
WebGL errors. It is not registered in `glTextureWrappers`, retained by its owner or deleted by `WebGLRenderer.destroy()`.
Restore calls `init()` again; live-context reinitialization also accumulates placeholders. Registered-wrapper counts alone miss it.
After ten native World restarts and two real context epochs, the consuming game's final valid epoch had 147 texture creates,
146 deletes and one valid survivor whose creation stack was `WebGLTextureUnitsWrapper.init -> WebGLRenderer.dispatchContextRestored`.
Framebuffers balanced 5/5 with zero live handles. Retained dead framebuffer-array entries were a separate harness-counting error.

**Temporary dependency band-aid.** Copy the exact released
[phaser-texture-units-patch.mjs](../scripts/assets/phaser-texture-units-patch.mjs) into the consuming project's scripts
and run it from the existing postinstall after installing Phaser:

```sh
node scripts/phaser-texture-units-patch.mjs node_modules/phaser
```

An existing Node postinstall can import `patchTextureUnits` and `await patchTextureUnits(installedPhaserDirectory)`.
Import alone has no side effect. The helper requires exactly `phaser@4.2.1`; it preflights both native owners
(`src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js` and `src/renderer/webgl/WebGLRenderer.js`) and both consumed
bundles (`dist/phaser.esm.js`, `dist/phaser.js`) before any write. Only unambiguous all-original or all-corrected fragments
with common LF/CRLF are accepted. Missing, unknown, duplicate, mixed fragment/target states or mixed newlines fail without
partial edits. Outside bytes are preserved and repeat installation is idempotent. It composes in either order with all five
released audio decode, audio visibility, gamepad lifecycle, framebuffer restore and DynamicTexture helpers; preserve existing
held-input corrections too. Update consuming integrity guards and invalidate the old dependency optimizer cache.

The native owner retains `tempTexture` for the whole rendering lifetime. Before reinit it deletes only its still-valid
current-context placeholder, and its idempotent `destroy()` releases that valid handle and clears its own references.
Native renderer destruction invokes the owner while GL is still available. `isContextLost()` and `isTexture()` keep
context-invalidated handles out of deletion. The initial/restored placeholder, blue upload, active-unit behavior, ordinary
wrapped bind/null/unbind semantics and restoration order stay native. Immediate placeholder deletion defeats sampler
completeness; a game cleanup shim, custom registry, broad native-array clearing or warning suppression does not correct ownership.
Remove this band-aid only after an equivalent reviewed, pinned upstream fix passes live reinit, ordinary/lost destruction,
real context epochs and preserved initial/restored authored-pixel checks.

**Evidence and limits.** [Node tests](../../../tests/phaser-texture-units.test.mjs) execute the actual complete native owner
and renderer destroy/restore methods with their native Class and minimal external-boundary doubles. The
[fixture](../../../tests/fixtures/phaser-texture-units-4.2.1.json) retains exact native bytes and SHA-256 hashes from the
npm tarball verified against SHA-512 integrity, SHA-1 and SHA-256. Tests cover live sampler completeness, ordinary bindings,
repeat destruction, live reinit, restore and destroy-while-lost, plus API/CLI refusal, LF/CRLF, unchanged bytes and composition.

A separate integrity-bound package with all six helpers passed a focused Chromium 153 / NVIDIA RTX 5070 Ti ANGLE/D3D11
WebGL 1 proof. Six live-context reinitializations retired their previous valid placeholder. Two actual context loss/restore
epochs kept the restored placeholder valid; native RenderTexture target/on-screen and Image pixels all returned RGBA
`(98, 201, 168, 255)` before and after restoration. The final non-invalidated epoch balanced 6 texture creates/deletes and
1 framebuffer create/delete, with zero valid handles and zero registered LIVE wrappers after native Game destruction.
The native dead framebuffer array retained one entry. Native AudioContext closed, game/scene/canvas were released, and the
owned browser/server/port closed. Four expected native context messages were retained separately; unintended browser/GL
warnings and errors were zero. The actual served optimizer response/cache/map was bound to corrected ESM bytes.
Earlier invalidated epochs are context-freed, not balanced-delete evidence. This proves the scoped pinned owners on this
backend; it does not establish full planet/game acceptance, sustained memory magnitude, every custom effect or phone/backend certification.
