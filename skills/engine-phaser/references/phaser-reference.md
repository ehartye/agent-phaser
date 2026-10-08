# Phaser best-practices reference (index)

One page to scan before writing Phaser 4 code. Each row is a rule, the reference that carries the reason, a generic example and the 4.2.1
evidence, and where the Fallow Valley repo (`fallow-valley-next`, private) demonstrates it (`example:` paths are relative to its root).
Everything marked *verified* was read from `node_modules/phaser/src` or reproduced in a real-GPU browser; rules marked *convention* are design
choices that paid off, not engine facts.

## Architecture and flow

| Rule | Where | Fallow Valley example |
| --- | --- | --- |
| The world is `f(seed) + delta`; Phaser is a view. Headless sim, typed commands in, typed events out | [architecture](architecture.md) | `src/sim`, `src/sim/events.ts` |
| The boundary is a test (scan sim and content for `phaser`, DOM, `Math.random`, `Date`) | [scenes, loop and plugins](scenes-loop-and-plugins.md) 6 | `tests/architecture.test.ts` |
| State in a global `BasePlugin` mapped onto scenes; scenes subscribe through `bind` that unsubscribes on `SHUTDOWN` (*verified*: `PluginManager.addToScene`) | scenes 3 | `src/game/plugins/SimHostPlugin.ts` |
| Constants (scene, texture, registry keys, depths) in one `as const` file | scenes 1 | `src/game/config.ts` |
| `Phaser.WEBGL`, not `AUTO`, when you need GPU layers or filters; fail in pixels with the smallest dependency | scenes 2 | `src/game/scenes/BootScene.ts` |
| WebGL 2 is officially supported; 4.2.1 defaults to GL1 and accepts a supplied GL2 context; ES3 custom programs need matching stages | [WebGL backends](webgl-backends.md) | Cyberpunkt's linked GL1/GL2 pixel probe; AE is a separate engine |
| `start` hands off, `launch` runs beside; load shared assets once; swap state in `init` through a start-data callback | scenes 4, [gotchas](phaser-4-gotchas.md) 11 | `scenes/worldAssets.ts`, `WorldScene.init` |
| One `SHUTDOWN` handler removes every long-lived subscription; restart-leak test | gotchas 14 | `tests/browser/lifecycle.spec.ts` |
| Hold the loop on blur, hidden and context loss; `noAudio` if sound is elsewhere | gotchas 15 | `src/game/loop/Attention.ts` |
| Fixed-step accumulator with a capped catch-up, return alpha, capture previous inside the step, one tooling hook | scenes 5 | `src/game/loop/FixedStepper.ts` |
| Phaser's scene `delta` is smoothed (*verified*) | gotchas 17 | `WorldScene.update` |
| Save the RNG state in snapshots | architecture, SKILL.md | `src/sim/sim.ts` snapshot |

## World rendering

| Rule | Where | Example |
| --- | --- | --- |
| Pooled chunk views bound to the camera range plus a margin; draw only views that touch the view; repaint a tile and its 8 neighbours; reconcile continuous state on a timer | [tilemaps](tilemaps-and-terrain.md), [performance](performance.md) | `src/game/view/ChunkStreamer.ts` |
| GPU layer for dense or animated ground, CPU layers for sparse (*verified* gotchas 1, 2); sparse GPU layers need a transparent first cell | tilemaps, gotchas 1, 2 | `src/game/view/ChunkView.ts` |
| Keep GPU layers at (0,0), position a container (*verified*: double position) | gotchas 1 | `ChunkView.bind` |
| `skipCull` on CPU layers in positioned containers; alpha on the layer, not the container (*verified*) | gotchas 18, 8 | `ChunkView.makeLayer`, `setRoofAlpha` |
| One shared `Tileset` per atlas and layer kind | performance 2 | `ChunkView.sharedTileset` |
| Animated tiles on GPU layers only; fix the animation index map; phase-offset loops | gotchas 3, 10 | `src/game/view/TileAtlas.ts` |
| Pure `TileComposer` from sim state to frame names; 47-mask autotile; priority encroachment overlays; flavours by hash | tilemaps | `TileComposer.ts`, `blend.ts`, `groundkit.ts` |
| Namespace animation keys per atlas (*verified*: `createFromAseprite` uses the bare tag name) | gotchas 5, [asset wiring](asset-wiring.md) | `src/game/assets/anims.ts` |
| Shadows: tile shadows from neighbours in one layer at one alpha; pooled shadow sprites for entities; decision tables keyed by content ids | [ambient motion](ambient-motion.md) | `src/game/view/shadows.ts`, `ShadowSprites.ts` |

## Light, motion and effects

| Rule | Where | Example |
| --- | --- | --- |
| Pure grade, eased; light map one texel per world pixel, MULTIPLY, NEAREST, stepped bands; skip in full daylight | [lighting](lighting-and-atmosphere.md) | `src/game/view/Atmosphere.ts` |
| Camera filters on the world camera only, `setActive(false)` when idle; UI in its own scene | lighting 3 | `Atmosphere` constructor |
| Measure `setLighting` before rejecting it | lighting 4, gotchas 9 | `docs/ATMOSPHERE.md` |
| Emitter for mass effects; reconfigure one emitter; never call `setFrequency` every frame (*verified*); a death zone is any `contains` | gotchas 16 | `src/game/view/WeatherFx.ts` |
| Bespoke pool (typed arrays, free list, whole pixels, palette colours, rules as data) when particles need rules or light | ambient motion | `src/game/view/AmbientFx.ts` |
| World-locked `TileSprite` layers moved by rounded offsets | ambient motion | `src/game/view/SkyLayers.ts` |
| Whole-pixel shake and hit stop | gotchas 12 | `src/game/view/FxDirector.ts`, `feel.ts` |

## UI, input and audio

| Rule | Where | Example |
| --- | --- | --- |
| One integer scale per layer, chosen from device pixels; UI is its own scene and camera; match devicePixelRatio | [pixel-perfect and UI](pixel-perfect-and-ui.md) 1, 2 | `src/game/ui/UiScale.ts`, `DevicePixels.ts` |
| All text is `BitmapText` from the tool export; no `Text`, CSS or DOM text; tone is glyph frames, not tint | pixel-perfect 3 | `src/game/ui/PixelFont.ts` |
| Panels tiled, not `NineSlice`-stretched; scrim is a dither; tweens round every frame | pixel-perfect 4 | `src/game/ui/Skin.ts` |
| Phaser 4 WebGL clipping uses native filter masks or camera viewports, not legacy `setMask`; clip input separately and bound surfaces | pixel-perfect 8 | `examples/web/phaser-probes/scroll-mask.mjs` in agent-engine |
| Accessible controls and native text entry project the same screen/action model as Phaser; no DOM-count ban or duplicate layout | pixel-perfect 7 | Guidance; existing `ui/AriaLive.ts` covers announcements only |
| Text fit in three layers (static table, runtime guard, GPU walk-through) | pixel-perfect 5 | `src/game/ui/TextGuard.ts`, `tests/text-fit.test.ts` |
| Dedupe keydown by event identity (*verified*: shared queue, per-scene dispatch); input capture state | pixel-perfect 6 | `src/game/ui/keys.ts` |
| Start with native Gamepad configuration and one input owner; reproduce version-specific lifecycle defects before a scoped fallback; position-named buttons | [gamepad and input](gamepad-and-input.md) | `src/game/input/*` is a custom example, not a native-first template |
| Touch: Phaser 4.2.1 listens to touch events and tracks one finger unless `input.activePointers` is raised (*verified*, `InputManager`); gestures as a pure recognizer on a fake clock; tap to move is a sim command (`goto`, incremental A\*), never a view-side move; bare ground is never worked by a tap; whole-number pixel-ratio tiers | [touch and mobile](touch-and-mobile.md) | `src/game/input/touch.ts`, `tapIntent.ts`, `src/sim/pathfind.ts`, `docs/MOBILE.md` |
| Recorded exports use native Phaser loading/cache/playback; game policy selects audio. Beeps procedural/adaptive playback is an explicit alternative, with one owner | [native audio](native-audio.md), [beeps integration](audio-directors.md) | Pinned Phaser sound source; `src/game/audio/*` is a beeps-based example |

## Verification, performance, pipeline

| Rule | Where | Example |
| --- | --- | --- |
| Real GPU, assert pixels (`snapshotPixel` in the page), mutation-prove every regression test | [verifying](verifying-on-a-gpu.md) | `tests/browser/phaser-evidence.spec.ts` |
| Drive the real loop by hand (`loop.sleep`, `game.step`), one gated debug API for panel, tests, tools and demos | verifying | `src/game/debug/*`, `docs/HARNESS.md` |
| Record and replay with state hashes; visual regression; perf budgets; two workers | verifying | `src/game/debug/replay.ts`, `tests/visual`, `tests/perf` |
| Measure first: vsync off, CPU frame ms, wrapped draw-call counter, layer toggles, CPU throttle | [performance](performance.md) | `src/game/debug/perf.ts` |
| Source art checked in, built into `public/`, typed catalogue, contract tests both ways; gapless sheet is also the tileset; fix the tool, not the game | [asset wiring](asset-wiring.md) | `asset-src/`, `tests/assets.test.ts` |

## Method

Read Phaser's own skills in `node_modules/phaser/skills` first. When a render looks wrong: build the smallest standalone object in the live
scene, read a pixel whose value you know, toggle layers one at a time, print the data to separate a data bug from a render bug, read the
renderer source once you have a suspect, and prove the regression test by mutation ([gotchas](phaser-4-gotchas.md), "How these were found").
Write down limits honestly: what the view still reads from the sim, which fixes patch Phaser's data, what only a human playtest can judge.

## Process rules from the architecture review

Shipping code must not import the debug tooling (load it through a gated dynamic `import()` and reach the loop through one hook); turn on
`noUnusedLocals` and `noUnusedParameters`; keep architecture tests for layer imports and host globals; keep an audit record of what was
reviewed, fixed and deferred with reasons (fallow-valley-next `docs/ARCH-REVIEW.md`).

Guards worth adding beyond layer imports: an unsubscribed long-lived `game.events` or `scale` listener; only the entry file may reach the debug tooling; `Command` and `SimEvent` switches are exhaustive; no `waitForTimeout` in specs (wait on state or frames, see [verifying](verifying-on-a-gpu.md)); every link, anchor and path in the Markdown resolves; a **practices checker** (a table of rule to file and symbol, checked by a test, with a `--fix` that moves drifted line anchors) so docs cannot name a deleted symbol. Put the restart-leak spec in the CI smoke set: a CI that ran 2 of 19 browser specs hid regressions.
