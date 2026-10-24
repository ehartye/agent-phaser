# Game config, boot and bundling (Phaser 4.2.1)

What to put in `new Phaser.Game(config)`, which defaults surprise, how the game boots and dies, how the frame rate is limited and how the ESM or UMD build reaches the page. Facts are read from `src/core` and `package.json` of 4.2.1; `[tested]` ones are check ids of [the foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs).

## Boot order and what it means for your code

- [documented] `Game` parses `Config`, builds the managers (anims, textures, cache, registry, input, scenes, scale, sound, loop, plugins), waits for DOM ready, then runs `callbacks.preBoot`, creates the renderer and canvas, appends it, emits `BOOT`, waits for textures `READY`, runs `postBoot` and starts the loop (`src/core/Game.js`). Only the first scene of `scene: [...]` starts unless another has `active: true` (`src/scene/SceneManager.js`).
- [tested] `game.canvas` is `null` right after the constructor when it runs in a classic script (head or body); only a module or deferred script boots at once (`config-boot-timing`). Read the canvas or renderer in `callbacks.postBoot` or the first scene's `create`, not after `new`.
- [tested] `game.destroy(true)` only sets a flag; the next loop step tears down. A loop put to sleep with `game.loop.sleep()` never finishes it until `wake()` (`config-destroy-needs-a-running-loop`). On hot reload, destroy the old game before creating the next and wait for `Core.Events.DESTROY`.

## Config options that need a decision

| Option (4.2.1 default) | Decide |
| --- | --- |
| `type` (`AUTO`) | `Phaser.WEBGL` for any Phaser 4 feature (filters, GPU layers, lights, stencil); `AUTO` silently falls back to the deprecated Canvas renderer. `HEADLESS` has no renderer but still needs a DOM. |
| `pixelArt` (false) | Sets `antialias` and `antialiasGL` false and `roundPixels` true. Use when art is shown unscaled. `smoothPixelArt` (WebGL) is for art scaled up or rotated; it turns `pixelArt` off. Do not combine; see [phaser-pixel-ui](../../phaser-pixel-ui/SKILL.md). |
| `roundPixels` (false; true in v3) | Rounds only axis-aligned, unscaled objects, and only while the camera zoom is an integer. |
| `transparent` (false) | False requests an opaque canvas (`alpha: false`), which compositors draw faster; true only when the page shows through, and then `backgroundColor` is ignored. |
| `stencil` (true) | False drops the stencil buffer from every framebuffer and disables `Stencil` objects ([phaser-rendering](../../phaser-rendering/SKILL.md)). |
| `powerPreference`, `failIfMajorPerformanceCaveat` | Hints on dual-GPU machines; the second turns a software-GL machine into a creation error you can report. |
| `preserveDrawingBuffer` (false) | Costs memory; for pixels use `renderer.snapshot` inside `POST_RENDER` instead. |
| `mipmapFilter` (`''`), `mipmapRegeneration` (false) | Mipmaps only help textures drawn far below source size. Regeneration costs 10 microseconds or more per redrawn target and applies to DynamicTextures only; filters never use mipmaps (4.1.0 changelog). |
| `skipUnreadyShaders` (false) | True avoids compile hitches, but an object whose shader is still compiling is not drawn that frame (pop-in). |
| `autoMobileTextures` (true) | On iOS and Android a batch uses one texture, so more draw calls; pack atlases accordingly. |

- [documented] The table's defaults and effects come from `src/core/Config.js`, `src/core/typedefs/RenderConfig.js` and `src/renderer/webgl/WebGLRenderer.js`; what a browser does with the hints is [general].
- [documented] `scale.*` wins over top-level `width`, `height`, `zoom`, `parent`; `render.*` wins over top-level render flags; the default size is 1024x768, not 800x600 (`src/core/Config.js`). [tested] `config-derived-flags` reads these from `Core.Config`, including `alphaStrategy` `keep`, `stencilAlphaStrategy` `dither`, `loader.maxRetries` 2 and `input.activePointers` 1.
- [tested] `type: WEBGL` makes a WebGL 1 context whose attributes follow the config (`alpha` is `!transparent`, `antialias` is `antialiasGL`, `stencil` is `render.stencil`); WebGL 2 needs a supplied `context` (`config-context-is-webgl1-and-follows-config`, [WebGL backends](../../phaser-rendering/references/webgl-backends.md)). A supplied WebGL 2 context rules out `smoothPixelArt`: Phaser's own shader for it fails to compile there and the render loop stops, so use `pixelArt` with an integer zoom instead.
- [general] Input, audio, loader and physics blocks belong to their domain skills: [phaser-input](../../phaser-input/SKILL.md), [phaser-audio](../../phaser-audio/SKILL.md), [loading assets](loading-assets.md), [phaser-physics](../../phaser-physics/SKILL.md).

## Boot traps

- [tested] `parent` is an element id, not a selector: `'#game'` and a mistyped id both append the canvas to `document.body` without an error (`config-parent-is-an-id-not-a-selector`). Assert `canvas.parentElement` in a test.
- [documented] An unsupported renderer throws `Cannot create WebGL context, aborting.` from the DOM-ready callback (`src/core/CreateRenderer.js`, `src/dom/DOMContentLoaded.js`), so a `try` around `new Phaser.Game` catches it only when the DOM is already parsed. [general] Probe `canvas.getContext('webgl')` first and draw the failure in plain HTML.
- [tested] The typings declare `Phaser.Device`, but 4.2.1 does not export it at run time (`migration-v3-apis-are-gone-or-stubbed`); read `game.device` after boot.

## Frame rate

- [documented] `fps.target` is advisory, `smoothStep` (true) averages ten deltas and, with `fps.min` (5), replaces a delta above 200 ms by the oldest value in that window (the stall is lost), `forceSetTimeOut` swaps requestAnimationFrame for a timer, and `fps.limit` only slows the loop below the display rate (`src/core/TimeStep.js`). `game.loop.setFPSLimit(n)` (4.2.0) changes the limit while running; `0` removes it.
- [tested] A limit of 30 about halves the `step` rate and `setFPSLimit(0)` restores it (`config-fps-limit-throttles-steps`).
- [documented] The limiter adds the smoothed delta, calls the scene once the sum reaches `1000 / limit`, passes the whole sum and keeps the remainder (`stepLimitFPS`). A limit that does not divide the refresh rate (45 on 60 Hz) therefore delivers uneven frame spacing; use limits only to save power, never to pace rules ([fixed-step loop](scenes-loop-and-plugins.md)).

## ESM, UMD and the bundler

- [tested] `package.json` exports only `.` (import `dist/phaser.esm.js`, require `dist/phaser.js`) and `./package.json`; `phaser/dist/...` and `phaser/src/...` deep imports throw `ERR_PACKAGE_PATH_NOT_EXPORTED` (`config-exports-map`). To use the Arcade-only bundle, alias its file path in the bundler.
- [tested] The ESM build does not set `window.Phaser`; the UMD build does (`config-esm-has-no-global`). A bare `Phaser.` in a file that did not import it fails at run time; the typings hide this ([gotcha 4](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md)). Use `import Phaser from 'phaser'`.
- [documented] Named ESM exports mirror the namespace plus `default`; they include `Math`, so `import { Math } from 'phaser'` shadows the global (`dist/phaser.esm.js`). The ESM build lacked its default export and `Class` before 4.1.0, and `CombineColorMatrix`, `ImageLight` and `Texture` read the global until 4.2.1 (`changelog/v4`); pin 4.2.1 or later.
- [tested] Phaser is one prebuilt file: `phaser.esm.min.js` is 1.38 MB, about 355 KB gzip and 283 KB brotli, and the Arcade-only build is 8% smaller (`config-bundle-sizes`).
- [general] Budget for that download and keep Phaser in its own chunk so game edits do not invalidate it (not run here).
- [documented] The typings use `export = Phaser` (`types/phaser.d.ts`), so TypeScript needs `esModuleInterop` or `allowSyntheticDefaultImports` for the default import.

## Verify

- [tested] `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project> --only=config` prints one line per check id used above. The host project supplies `phaser` 4.2.1 and `@playwright/test`; a software renderer is enough because the checks read sizes and flags, not pixels.
