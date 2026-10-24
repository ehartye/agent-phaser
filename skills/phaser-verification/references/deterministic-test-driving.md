# Driving a Phaser 4 game deterministically

Read this before you write a test that advances a game, replays input or compares two runs. In 4.2.1 not every system follows `game.step(time, delta)`: tweens read the wall clock, and two of the usual random helpers are unseeded. Backed by [`phaser-verification-driving.mjs`](../../../examples/web/phaser-probes/phaser-verification-driving.mjs). The waits and the debug API are in [loop and waiting](verifying-loop-and-waiting.md); this page does not repeat them.

## Which clock drives what

| System | Reads | Follows `game.step(t, dt)`? |
| --- | --- | --- |
| Scene clock (`time.delayedCall`, `time.addEvent`) | the `time` the step passes | yes |
| Arcade physics | the step `delta` | yes |
| Tweens (`tweens.add`) | `Date.now()` | no |
| `Phaser.Math.RND` | the config `seed` | yes, once seeded |
| `Phaser.Math.Between`, `Utils.Array.Shuffle`, particles, camera shake | `Math.random()` | no |
| `game.loop.frame`, `time`, `actualFps` | the real loop | no, a direct `game.step` bypasses it |
| `AudioContext` clock | the audio device | no, and Playwright's fake clock does not cover it |

- [documented] `TweenManager.getDelta` computes elapsed time from `Date.now()`, ignores the scene's step delta, and treats a gap over `maxLag` (500 ms) as `lagSkip` (33 ms) (`src/tweens/TweenManager.js`). `Phaser.Math.Between`, `FloatBetween`, `Shuffle` and `GetRandom` call `Math.random()`; only `Phaser.Math.RND` is seeded (`src/math/Between.js`, `src/core/Config.js`). `game.loop.frame`, `time` and `actualFps` advance only inside `TimeStep.step` (`src/core/TimeStep.js`), which a direct `game.step` call skips.
- [tested] Sixty `game.step(t, 16.67)` calls took about 2 ms of real time and fired a 1000 ms timer and let an Arcade body fall 49 px, but moved a 1000 ms tween by under 1 percent. A test that asserts a tween position after stepping by hand passes or fails on machine speed.
- [documented] `game.step()` and `headlessStep()` return at once while `game.isPaused` is true (`src/core/Game.js`), so a test that calls `game.pause()` and then steps by hand advances nothing. Use `game.loop.sleep()` to stop the real loop and keep stepping; keep `pause()` for the pause behaviour itself.
- [general] Tween timing, freezing and a `Date.now` replacement that makes tweens follow `game.step` belong to [phaser-motion](../../phaser-motion/SKILL.md); Arcade and Matter stepping belong to [phaser-physics](../../phaser-physics/SKILL.md).
- [general] Animations, particles and camera effects take the step `delta` in their update signatures; add them to the probe before you depend on that. Playwright's fake clock lists `Date`, timers, `requestAnimationFrame`, `performance` and `Event.timeStamp`, not the audio clock.

## Pick a driver

| Driver | Use it when | Cost | Limit |
| --- | --- | --- | --- |
| Rules in a Phaser-free sim, tested in Node | the rules, scoring, AI, save data | none at run time; needs the split in [architecture](../../phaser-architecture/SKILL.md) | no view, no pixels |
| `game.loop.sleep()` plus `game.step(t, dt)` | physics, timers, state machines, a pixel read | microseconds a frame; exact frame counts | tweens follow real time; audio loops stop |
| `type: Phaser.HEADLESS` plus `game.headlessStep(t, dt)` | long logic soaks, thousands of steps | fastest, no renderer or GPU | no `snapshotPixel`; `game.step` throws |
| Playwright `page.clock` | anything with tweens, or a scene you cannot split | each fake frame still renders; about 31 frames per 500 ms | needs a real browser; ignores the audio clock |
| Phaser's own jsdom helper | scene logic in a unit-test runner | a vitest and jsdom install | no WebGL, no pixels |

- [tested] With `HEADLESS`, `game.renderer` is `null`, a canvas still exists in the DOM, `game.step()` threw `Cannot read properties of null (reading 'preRender')` and `headlessStep()` stepped Arcade physics normally.
- [general] In a scratch project (not committed here) `vitest@3.2.4` and `jsdom@26.1.0` ran the package's `tests/setup.js` as the vitest setup file, booted `new Phaser.Game({type: Phaser.HEADLESS, ...})` and stepped Arcade physics with `headlessStep` in about 10 ms. Four of the package's own 1,999 tween and physics tests failed in that run, so do not treat its suite as a green baseline (`tests/TESTING.md` lists what Phaser does not test: pixels and WebGL renderer code). This recipe is not committed here.

## Driving with page.clock

```js
await page.clock.install({time: 0});
await page.clock.pauseAt(1000);   // before goto: nothing ticks while the page boots
await page.goto(url);             // create() has run, no frame has
await page.clock.runFor(500);     // requestAnimationFrame, Date and performance advance together
```

- [tested] Installed and paused before `goto`, two runs were identical: 0 frames at the start, 31 frames and a tween at x = 48 of 100 after `runFor(500)`, 68 frames and the tween and a 1000 ms timer complete after 600 ms more.
- [general] Pausing after `goto` lets real time pass during boot, so frame counts and tween positions differ by a frame or a few pixels between runs. Playwright documents that `install` must come before other clock calls ([clock API](https://playwright.dev/docs/clock)).

## Input in a hand-driven loop

- [tested] Real and dispatched DOM key and mouse events reach Phaser input at once: with the loop asleep, `Key.isDown` and the `keydown-SPACE` handler updated before any step, and a dispatched `KeyboardEvent` on `window` and `MouseEvent` on the canvas worked.
- [tested] Polling code can miss them. A press and release between two steps left `isDown` false and `JustDown` false (`onUp` clears it); only the event handler and `JustUp` saw it. Hold the key across a step, or use event handlers for input that must not be missed.
- [documented] The keyboard queue is cleared on `POST_STEP` (`src/input/keyboard/KeyboardManager.js`). [tested] With no frame between events, a new key event re-delivered the earlier queued keydown: the handler ran twice. Step a frame between key events.

## Seeds, readiness and replay

- [tested] With `seed: ['fixed']`, `Phaser.Math.RND.between` repeated across page loads and `Phaser.Math.Between` did not. A `Math.random` replaced by a seeded generator in `page.addInitScript` made both repeat. Use `RND` in game code and pin `Math.random` in tests for the rest.
- [tested] `create()` runs before the first render (a counter of `postrender` events read 0 inside `create`). A flag set in `create` means built, not drawn. For a pixel read, wait for the first `Phaser.Core.Events.POST_RENDER` after it, or step one frame yourself ([pixel assertions](visual-and-pixel-assertions.md)).
- [general] Record commands against the frame index, not the clock: `{frame, type, code}` per input, plus a state hash every N frames. Replay on a fresh page with the same seed by stepping and dispatching the events before each step; the first differing hash names the frame to bisect. The method is in [loop and waiting](verifying-loop-and-waiting.md).
