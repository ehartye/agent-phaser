# Phaser 4.2.1 API, lighting and effects gotchas

Imports, animation registration, removed methods, lighting and filters, shake, emitters and prop-owned art. Numbers match the index in [phaser-4-gotchas.md](phaser-4-gotchas.md).

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

- [general] `Tilemap.createBlankLayer` has no GPU argument. Build GPU layers with `make.tilemap({ data })` and
  `createLayer(0, tileset, 0, 0, true)`. A 2D array of tile indices is enough; no Tiled file is needed.
- [general] GPU layers do not repaint on `putTileAt`. Call `generateLayerDataTexture()` once after a batch of edits. Calling it
  many times in a frame across many layers works.
- [general] A tileset image can be a texture that also has atlas frames: `addTilesetImage(name, textureKey, w, h, 0, 0)` uses the
  source image, so a gapless sprite sheet doubles as a tileset.
- [general] `Phaser.Types` and the camera `worldView` are in world pixels; with zoom 3 a 1280 px canvas shows about 427 world
  pixels. Compute visible chunks from `worldView`, not from the canvas size.
- [general] The Phaser `skills` folder inside the package is the fastest accurate reference for v4 APIs.

## 9. Lighting, camera filters and render textures (measured on 4.2.1)

- [general] `setLighting(true)` works on CPU tilemap layers, sprites and images. Falloff is smooth and additive (easy to overexpose),
  there is no occlusion, and it is per-object opt-in, which is awkward with pooled chunk layers. About 0.9 ms for 8 lights at
  1280x720. For pixel-art bands, wall shadows or a grade, a world-locked light map is more controllable: a texture with one
  texel per world pixel (`RenderTexture` filled with ambient, ADD `stamp` pools; or a CPU canvas for occlusion), drawn over
  the world with MULTIPLY and NEAREST filtering.
- [general] Camera filters (`camera.filters.internal.addColorMatrix()`, `addDisplacement(key, x, y)`) keep pixel art crisp when the game
  is `pixelArt: true` (compare distinct colour counts with the filter on and off), cost nothing while `setActive(false)`, and
  only affect that camera, so a UI scene is untouched. `ColorMatrix.saturate(-1)` is full grayscale, `0` is identity.
- [general] `RenderTexture`/`DynamicTexture` commands (`fill`, `stamp`) are queued and run (and are cleared) only on `render()`. Never
  queue without rendering.
- [general] To measure cost instead of vsync, launch Chromium with `--disable-gpu-vsync --disable-frame-rate-limit` and read
  `game.loop.actualFps`.

## 12. Whole-pixel screen shake

`camera.shake` offsets by fractions of a pixel, which smears pixel art. Use the camera's follow offset instead: every ~33 ms
pick an integer offset (a hash of the step index, so it is repeatable), let the amplitude fall in whole steps to exactly 0, and set
`camera.setLerp(1, 1)` while it rings so the offset lands on the frame it is set (restore the lerp after). Assert in a test that
every sampled offset is an integer and that the last sample is `(0, 0)`. A hit stop is the same idea in time: skip the fixed-step
advance for 60 to 110 ms and keep the last interpolation alpha, never touching the sim's clock.
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

## 21. Reactive companion art on a prop (a level meter): atlas frames owned by the prop's view

Draw a level meter, status pip row or similar as extra atlas-frame images owned by the prop's view: create them lazily, `setFrame` only when the frame name changes, destroy
them in the same pass as the prop image. Author the meter as small pips with the build's outline flag so gaps fill with outline colour (a dark strip, no extra pixels). Detect
lit pips in browser tests by hue, not exact colour (the lighting pass tints the world). `screenOf(tileX, tileY)` already returns the middle of the tile; adding 0.5 puts it half a tile off.
