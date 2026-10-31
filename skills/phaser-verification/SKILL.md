---
name: phaser-verification
description: Prove a Phaser 4 change works and runs fast enough - deterministic stepping, pixel reads, scene-graph and physics debug draw, scene-restart leak tests, WebGL context loss, real-GPU and CI Playwright runs, mutation-proven regression tests and frame-budget profiling in Chrome. Use when proving a Phaser change on a real GPU, writing browser specs for a Phaser game, finding out what a Phaser scene really drew, making a test deterministic (tweens, seeds, input), checking a level restart for leaks, setting up CI for a Phaser game, or when a game misses a 60 or 120 fps budget. Not for choosing an engine (agent-engine:engine-selection), the renderer's behaviour (phaser-rendering) or cross-game test strategy (phaser-architecture).
---

# Phaser verification and performance

A plausible-looking screenshot can hide a layer covering the terrain. Phaser 4.2.1 has several behaviours that make a test pass or fail for the wrong reason (tweens on the wall clock, one pixel read per frame, listeners a restart leaves behind); each is proved by a probe in `examples/web/phaser-probes`. Read the reference that matches the work.

| You are about to | Read |
| --- | --- |
| Prove a change works on a real GPU | [verifying on a real GPU](references/verifying-on-a-gpu.md): [setup](references/verifying-playwright-setup.md), [assertions and harness](references/verifying-assertions-and-harness.md), [loop and waiting](references/verifying-loop-and-waiting.md) |
| Find out what a scene drew, which object is wrong, or what a silent failure hid | [debugging a Phaser game](references/debugging-a-phaser-game.md) |
| Locate current controls and prove real input without exporting Phaser objects | [native-control observation](references/native-control-observation.md) |
| Make a test repeatable: step by hand, fake the clock, seed the dice, replay input, wait for the first frame | [deterministic test driving](references/deterministic-test-driving.md) |
| Assert a colour or compare a screenshot: `snapshotPixel`, premultiplied alpha, tolerances, goldens | [pixel assertions](references/visual-and-pixel-assertions.md) |
| Write the scene-restart leak test, or test a lost and restored WebGL context | [leaks and lifecycle tests](references/leaks-and-lifecycle-tests.md) |
| Put browser tests in a pipeline, or choose the Chromium and renderer a run uses | [CI for Phaser](references/ci-for-phaser.md) |
| Measure and fix frame cost, draw calls, pooling | [performance](references/performance.md) |
| Hit a frame budget (60 or 120 fps) or cost +25% to +50% more content: decompose, ablate, price items, prove a fix exact | [profiling method](references/profiling-method.md), [Chrome frame budget](references/chrome-frame-budget.md) |
| Test Phaser audio | [testing audio](../phaser-audio/references/testing-audio.md) |

## Rules that earned their place

- [general] **Measure pixels, not impressions.** Read a pixel at a place whose expected colour you know, toggle layers and read it again.
- [general] **Prove a regression test by mutation.** Re-introduce the bug, watch the test fail, restore the fix.
- [tested] **Tweens ignore `game.step`.** Stepping by hand drives the scene clock and Arcade physics but the tween manager reads `Date.now()`. Use Playwright's `page.clock` (installed and paused before `goto`) when a tween matters, or keep it out of the assertion.
- [tested] **Only `Phaser.Math.RND` follows the seed.** `Phaser.Math.Between` and `Shuffle` use `Math.random()`. Set `seed` in the config, use `RND` in game code, and pin `Math.random` in the test page.
- [tested] **One pixel read per frame, and the canvas is black afterwards.** A second `snapshotPixel` before the same frame replaces the first, a negative coordinate is mirrored, and `drawImage(game.canvas)` after the frame reads black. Read points a frame apart or take one `snapshotArea`.
- [tested] **Every scene restart must be leak-tested, with counters.** Restart ten times and require display list, tweens, timers, textures, GL texture wrappers, sounds and every listener count on `game.events`, `scale`, `registry` and the scene's own events to match the baseline: Phaser removes only what it owns.
- [tested] **State the renderer and use `Phaser.WEBGL` in tests.** Playwright's default headless shell is software WebGL, new headless got the hardware GPU on the same machine, and `Phaser.AUTO` falls back to Canvas without a word when WebGL is missing. Print the renderer class on every run.
- [tested] **Silent failures need an assertion.** An unknown texture key draws `__MISSING` and logs nothing; scan the display list for it, and fail on any console line that is not on an allow-list.

## Verify

- [tested] `node examples/web/phaser-probes/phaser-verification-driving.mjs <project>`, `phaser-verification-pixels.mjs`, `phaser-verification-leaks.mjs` and `phaser-verification-renderer.mjs` (a project with `phaser@4.2.1` and `@playwright/test`) re-prove every `[tested]` claim above in headless Chromium. Rerun them after a Phaser or Playwright upgrade; a failure names the claim to update.

## Not covered here

Cross-game testing cost and publication gates are [phaser-architecture](../phaser-architecture/SKILL.md).
