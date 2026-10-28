# Verifying a Phaser game: the manual loop, waiting and determinism

Driving the real loop by hand, waiting without sleeps, determinism proofs and a debug API. Index: [verifying-on-a-gpu.md](verifying-on-a-gpu.md).

## Drive the real loop by hand, deterministically

`game.loop.sleep()` stops `requestAnimationFrame` and keeps the callback; `game.step(time, delta)` then runs one whole frame (pre-step, every
scene update, render) with the clock you give it, with no delta smoothing; `game.loop.wake()` gives it back. With a virtual clock, the
scene `time` clock, Arcade physics and the fixed-step stepper follow it, so tests need no `waitForTimeout`. Tweens do not: Phaser 4.2.1's tween manager reads `Date.now()` ([which clock drives what](deterministic-test-driving.md)).

- [tested] Keys and pointer events reach Phaser's handlers at the DOM event, not at the next step, but `update()` code that polls `isDown` or `JustDown` only sees the state at a step, so a press and release between two steps is lost to it. Hold the key across a step, and step a frame between key events: the keyboard queue is cleared on `POST_STEP`, so with no frame between them a new event re-delivers the earlier ones ([input in a hand-driven loop](deterministic-test-driving.md)).
- [general] A tight synchronous `while (!ready) game.step()` starves the loader (asset XHRs finish on the event loop). Yield between frames.
- [general] Expose one typed debug object (`__game.debug`) that the panel, the browser tests, the command-line tools and demo mode all use:
  `frames(n, { dt })`, `ticks(n)`, `tp(place)`, `time(h)`, `weather(w)`, `layer(name, on)`, `state()`, `sample()` (fps, CPU ms, draw calls),
  `hash()`, `record()`/`stop()`/`replay(rec)` (a minimal version: [harness `debug.mjs`](../../../examples/web/harness/debug.mjs)). Gate it: always on the dev server, on a production build only when the URL asks
  (`?debug=1`), loaded through a dynamic `import()` so it is a separate chunk.
- [general] `evaluate` serialises a function: it cannot close over variables, and a TypeScript helper called inside it does not exist in the page.
  Never return a Phaser object from it.

## Waiting: conditions, frames and page time, never sleeps

- [general] `page.waitForTimeout` is a bet about today's machine speed: it broke when a bigger atlas slowed the first boot, hides what is being waited for inside a number, and
  on a software-GL runner (about one frame a second) it is wrong by an order of magnitude. Replace it, in this order:

| Waiting for | Use |
| --- | --- |
| a scene, modal or object you can name | `until(page, fn, arg)`: `waitForFunction` with `polling: 'raf'` |
| a genuine animation (fade, tween, camera ease) | `settle(page, frames)`: counts display frames, so a slow machine stretches the wait |
| the sim to have run | ticks of the sim's own clock, capped when it is paused |
| a duration that is the thing under test | `elapsed(page, ms)`: `performance.now()` polled in the page. Never "after 90 frames" on software GL |
| a condition while the loop is manual | `framesUntil`: run frames inside the page until it holds, yielding to the event loop between batches |

Add a **no-sleeps test** (scan the specs for `waitForTimeout` and in-page `setTimeout` promises; allow only a perf sample; make it prove it can fail). Specs that
`goto` then sleep then press Enter fail under load with "no game in progress": start the game through the debug API once the title scene is active.
Code: `examples/web/harness/tests/wait.mjs`, `no-sleeps.test.mjs`.

## Determinism proofs and regression tests worth having

- [general] **Record and replay**: the sim is `f(seed, command log)`. A recording is the seed, commands with their tick and a state hash every 100 ticks;
  replaying on a fresh sim names the first tick and state part that differ. Record camera-driven chunk generation too (it spawns creatures).
  Save the RNG state in snapshots and compare saved and restored sims side by side.
- [general] **Visual regression**: render a few dozen canonical scenes at a fixed size with the interface hidden and compare with a perceptual tolerance
  (`maxDiffPixelRatio`, colour `threshold`); one `snapshotPathTemplate` without `{platform}` if one GPU makes the baselines. Tag exact-pixel
  tests `@gpu` so a software-GL CI can skip them.
- [general] **Perf budgets** in a separate project that runs after the others on one worker.
- [general] **Two workers by default.** Eight Chromiums each loading the dev server and a WebGL context exhaust memory and push first load past any fixed
  sleep. Wait on state (the title scene being active), never on time; one retry locally, reported as flaky.
- [general] **Mutation scripts for pure logic**: a script holds `[name, file, exact text, replacement]` rows, rewrites one line, runs the unit tests, requires
  failure, and always restores the file. A survivor means the tests do not guard that line.

Run the suite twice: **gating** on SwiftShader (`@gpu` tests skipped) and the real-GPU suite locally before merge. A CI job for Firefox and WebKit needs `xvfb-run` with
`LIBGL_ALWAYS_SOFTWARE=1` and a PulseAudio null sink, and stays advisory until it has been green for a while (the ci-for-generated-assets reference of agent-engine:engine-asset-import); template `examples/web/harness/ci/smoke.yml`.

The harness covers the Playwright config, waits and no-sleeps guard; mutation scripts, visual regression and perf budgets are not included.

## A debug API, a manual frame loop and a page object (what replaces the sleeps)

The probes above each repeated "start, wait 600 ms, press Enter, wait 1200 ms". Under parallel workers the title was not up yet, Enter went nowhere, and the next
line failed with "no game in progress". Build the harness once instead (a minimal runnable one: [`examples/web/harness`](../../../examples/web/harness)):

- [general] **One typed debug object on the page** (`__game.debug`), loaded only in dev or when the URL asks (`?debug=1`, `?demo=name`) through a dynamic `import()` so a production
  build carries it as a separate chunk. It starts a world (`start({ seed, hour, weather, at, give, god })` once the title scene is active, never by key press), teleports to
  named places (biome interiors, points of interest, scripted encounters), sets the clock and pins weather, gives items, spawns, pauses,
  steps and scales time, toggles render layers, inspects the tile under the cursor, hashes the sim, snapshots, records and replays.
- [general] **A manual frame loop.** `game.loop.sleep()` then `game.step(virtualTime, dt)`: tests and capture advance by ticks and frames, not wall time (tweens excepted: they read `Date.now()`). Yield to the event loop between
  frames while waiting for scenes (asset loads finish there; a synchronous loop never lets `preload` complete). Code that polls input reads it at a step ([input in a hand-driven loop](deterministic-test-driving.md)).
- [general] **A page object and fixture** that fails every test on a console error or warning, exposes `start`, `step(ticks)`, `frames`, `screenshotWorld()` (interface hidden),
  pixel probes (`at`, `fraction`, `meanLum`), and `evalSim/evalDebug/evalWorld` wrappers (functions are serialised: pass data as an argument).
- [general] **Visual regression with `toHaveScreenshot`**: about twenty canonical scenes (biomes by time of day and weather), a perceptual tolerance, one baseline set, an update
  command. Tag GPU-only tests (`@gpu`) so a SwiftShader CI can run the rest as a smoke.
- [general] **Determinism**: hash the whole sim state (snapshot plus RNG words) and record inputs with periodic hashes. If generation spawns creatures and the camera drives
  generation, record the chunks the view generated or the replay diverges.
- [general] **Workers**: eight Chromium workers each with a WebGL context can exhaust memory; default to two, retry once, and report flaky tests rather than hiding them.
