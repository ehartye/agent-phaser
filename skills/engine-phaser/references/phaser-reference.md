# Phaser best-practices reference

One page to scan before writing Phaser 4 code. Each row is a rule and the reference that carries its reason and 4.2.1 evidence; the Where column links runnable code. *verified* means read from `node_modules/phaser/src` or reproduced in a real-GPU browser; *convention* means a design choice that paid off, not an engine fact.

## Rules by area

- [general] Each table indexes rules; the evidence is in the linked reference.

### Architecture and flow

| Rule | Where |
| --- | --- |
| The world is `f(seed) + delta`; Phaser is a view. Headless sim, typed commands in, typed events out | [architecture](architecture.md) |
| The boundary is a test (scan sim and content for `phaser`, DOM, `Math.random`, `Date`) | [scenes](scenes-loop-and-plugins.md) 6 |
| State in a global `BasePlugin` mapped onto scenes; scenes subscribe through `bind` that unsubscribes on `SHUTDOWN` (*verified*: `PluginManager.addToScene`) | scenes 3 |
| Constants (scene, texture, registry keys, depths) in one `as const` file | scenes 1 |
| `Phaser.WEBGL`, not `AUTO`, when you need GPU layers or filters; fail in pixels with the smallest dependency | scenes 2; [harness `game.mjs`](../../../examples/web/harness/game.mjs) |
| WebGL 2 is officially supported; 4.2.1 defaults to GL1 and accepts a supplied GL2 context; ES3 custom programs need matching stages; Phaser AE is a separate engine | [WebGL backends](../../phaser-rendering/references/webgl-backends.md) |
| `start` hands off, `launch` runs beside; load shared assets once; swap state in `init` through a start-data callback | scenes 4, [gotchas](../../phaser-rendering/references/phaser-4-gotchas.md) 11 |
| One `SHUTDOWN` handler removes every long-lived subscription; restart-leak test | gotchas 14 |
| Hold the loop on blur, hidden and context loss; `noAudio` if sound is elsewhere | gotchas 15 |
| Fixed-step accumulator with a capped catch-up, return alpha, capture previous inside the step, one tooling hook | scenes 5 |
| Phaser's scene `delta` is smoothed (*verified*) | gotchas 17 |
| Save the RNG state in snapshots | architecture, SKILL.md |

### World rendering

| Rule | Where |
| --- | --- |
| Pooled chunk views bound to the camera range plus a margin; draw only views that touch the view; repaint a tile and its 8 neighbours; reconcile continuous state on a timer | [tilemaps](../../phaser-worlds/references/tilemaps-and-terrain.md), [performance](../../phaser-verification/references/performance.md) |
| GPU layer for dense or animated ground, CPU layers for sparse (*verified* gotchas 1, 2); sparse GPU layers need a transparent first cell | tilemaps, gotchas 1, 2 |
| Keep GPU layers at (0,0), position a container (*verified*: double position) | gotchas 1 |
| `skipCull` on CPU layers in positioned containers; alpha on the layer, not the container (*verified*) | gotchas 18, 8 |
| One shared `Tileset` per atlas and layer kind | performance 2 |
| Animated tiles: CPU needs `startTime`; fix the GPU animation index map; phase-offset loops | gotchas 3, 10 |
| Pure `TileComposer` from sim state to frame names; 47-mask autotile; priority encroachment overlays; flavours by hash | tilemaps |
| Namespace animation keys per atlas (*verified*: `createFromAseprite` uses the bare tag name) | gotchas 5, [asset wiring](asset-wiring.md) |
| Shadows: tile shadows from neighbours in one layer at one alpha; pooled shadow sprites for entities; decision tables keyed by content ids | [ambient motion](../../phaser-worlds/references/ambient-motion.md) |

### Light, motion and effects

| Rule | Where |
| --- | --- |
| Pure grade, eased; light map one texel per world pixel, MULTIPLY, NEAREST, stepped bands; skip in full daylight | [lighting](../../phaser-worlds/references/lighting-and-atmosphere.md) |
| Camera filters on the world camera only, `setActive(false)` when idle; UI in its own scene | lighting 3 |
| Measure `setLighting` before rejecting it | lighting 4, gotchas 9 |
| Emitter for mass effects; reconfigure one emitter; never call `setFrequency` every frame (*verified*); a death zone is any `contains` | gotchas 16 |
| Bespoke pool (typed arrays, free list, whole pixels, palette colours, rules as data) when particles need rules or light | ambient motion |
| World-locked `TileSprite` layers moved by rounded offsets | ambient motion |
| Whole-pixel shake and hit stop | gotchas 12 |

### UI, input and audio

| Rule | Where |
| --- | --- |
| One integer scale per layer, chosen from device pixels; UI is its own scene and camera; match devicePixelRatio | [pixel-perfect](../../phaser-pixel-ui/references/pixel-perfect-and-ui.md) 1, 2; [source-pixels probe](../../../examples/web/phaser-probes/source-pixels.mjs) |
| All text is `BitmapText` from the tool export; no `Text`, CSS or DOM text; tone is glyph frames, not tint | pixel-perfect 3 |
| Panels tiled, not `NineSlice`-stretched; scrim is a dither; tweens round every frame | pixel-perfect 4 |
| Phaser 4 WebGL clipping uses native filter masks or camera viewports, not legacy `setMask`; clip input separately and bound surfaces | pixel-perfect 8; [scroll-mask probe](../../../examples/web/phaser-probes/scroll-mask.mjs) |
| Accessible controls and native text entry project the same screen/action model as Phaser; no DOM-count ban or duplicate layout | pixel-perfect 7 |
| Text fit in three layers (static table, runtime guard, GPU walk-through) | pixel-perfect 5 |
| Dedupe keydown by event identity (*verified*: shared queue, per-scene dispatch); input capture state | pixel-perfect 6 |
| Start with native Gamepad configuration and one input owner; reproduce version-specific lifecycle defects before a scoped fallback; position-named buttons | [gamepad](../../phaser-input/references/gamepad-and-input.md) |
| Touch: 4.2.1 tracks one finger unless `input.activePointers` is raised (*verified*, `InputManager`); gestures as a pure recognizer on a fake clock; tap to move is a sim command (`goto`, incremental A\*), never a view-side move; bare ground is never worked by a tap; whole-number pixel-ratio tiers | [touch](../../phaser-input/references/touch-and-mobile.md) |
| Recorded exports use native Phaser loading/cache/playback; game policy selects audio. Beeps procedural/adaptive playback is an explicit alternative, with one owner | [native audio](../../phaser-audio/references/native-audio.md), [beeps integration](../../phaser-audio/references/audio-directors.md) |

### Verification, performance, pipeline

| Rule | Where |
| --- | --- |
| Real GPU, assert pixels (`snapshotPixel` in the page), mutation-prove every regression test | [verifying](../../phaser-verification/references/verifying-on-a-gpu.md); [smoke spec](../../../examples/web/harness/tests/smoke.spec.mjs) |
| Retain the native sampler placeholder while rendering; release it through its owner on reinit and destruction (*verified*) | [gotcha 25](../../phaser-rendering/references/phaser-4-renderer-destruction-gotchas.md), [lifecycle checks](../../phaser-verification/references/verifying-on-a-gpu.md); pinned owner tests and a context-epoch proof in `tests/phaser-*.test.mjs` |
| Drive the real loop by hand (`loop.sleep`, `game.step`), one gated debug API for panel, tests, tools and demos | verifying; [debug API](../../../examples/web/harness/debug.mjs) |
| Record and replay with state hashes; visual regression; perf budgets; two workers | verifying |
| Measure first: vsync off, CPU frame ms, wrapped draw-call counter, layer toggles, CPU throttle | [performance](../../phaser-verification/references/performance.md) |
| Source art checked in, built into `public/`, typed catalogue, contract tests both ways; gapless sheet is also the tileset; fix the tool, not the game | [asset wiring](asset-wiring.md) |

## Method

- [general] When a render looks wrong: build the smallest standalone object beside the
scene, read a pixel of known value, toggle layers one at a time, print the data to separate a data bug from a render bug, read the
renderer source on a suspect, and prove the regression test by mutation ([how these were found](phaser-4-scene-lifecycle-gotchas.md)).

## Process rules from the architecture review

- [general] Shipping code must not import the debug tooling (use a gated dynamic `import()` and reach the loop through one hook); turn on
`noUnusedLocals` and `noUnusedParameters`; keep architecture tests for layer imports and host globals; keep an audit record of what was reviewed, fixed and deferred.

Further guards: no unsubscribed long-lived `game.events` or `scale` listener; only the entry file reaches the debug tooling; `Command` and `SimEvent` switches are exhaustive; no `waitForTimeout` in specs (wait on state or frames, see [verifying](../../phaser-verification/references/verifying-on-a-gpu.md) and the [no-sleeps guard](../../../examples/web/harness/tests/no-sleeps.test.mjs)); every Markdown link, anchor and path resolves; a tested practices checker (rule to file and symbol) so docs cannot name a deleted symbol.
