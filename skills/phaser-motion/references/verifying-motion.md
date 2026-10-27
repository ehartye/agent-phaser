# Verifying motion deterministically (Phaser 4.2.1)

How to make a test or a capture see the same motion on every run when tweens, timers and animations sit on different clocks. Read it with the hand-driven loop in
[loop and waiting](../../phaser-verification/references/verifying-loop-and-waiting.md), which says a virtual `game.step` clock moves tweens too: in 4.2.1 it does not
(`tween-wall-clock`). `[tested]` labels name checks in the [clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs)
(`node phaser-motion-clocks.mjs <project> [<4.2.0 package>]`, about twelve seconds).

## Pick the technique

| Technique | Moves | Leaves out | Use it for |
| --- | --- | --- | --- |
| Playwright fake clock: `page.clock.install({ time: 0 })` before the game is created, then `page.clock.runFor(ms)` | everything: rAF, `Date.now`, `performance.now` and timers, so tweens, timers, animations, timelines and followers | real network loads | whole-scene captures and motion regressions |
| `game.loop.sleep()` then `game.step(t, dt)` | scene-clock systems: timers, animations, timelines, the fixed-step sim | tweens, followers | rules and animation frames |
| The same, with `Date.now` replaced by a virtual clock you advance by `dt` | everything above plus tweens | nothing else | a hand-driven loop that includes tweens |
| `tweens.pauseAll()` then `tween.update(dt)` or `seek` | one tween you choose | the rest of the scene | exact pose of one tween |
| The real loop plus waits | whatever the machine allows | exactness | smoke tests only |

- [tested] `page-clock-drives-tweens`: with the fake clock installed, `runFor(600)` took a 1000 ms tween to progress 0.59 and fired a 500 ms scene timer; tweens, timers and
  animations agree because rAF, `Date.now` and `performance.now` all move together.
- [tested] `fast-forward-is-clamped`: `page.clock.fastForward(1000)` jumps time and fires due timers at most once (Playwright's documented behaviour), so Phaser sees one gap over 500 ms and
  keeps 33 ms of it: progress was 0.09, not 1. Use `runFor`, in steps of at most 100 ms.
- [tested] `date-now-patch-drives-tweens`: set `Date.now = () => virtualMs` inside the page and advance it with each `game.step`; a 1000 ms tween then reached progress 0.48 after
  30 frames of 16.667 ms and 1 after 80. Restore the original afterwards, and keep each step under 500 ms.
- [general] Create the fake clock before the game, wait for the loader with a real condition (`scene.load.once('complete', ...)`), and only then call `runFor`; a loader finishes on
  real network time, not fake time.

## Asserting poses

- [tested] `manual-tween-update`: the first `update()` only starts a tween, and `seek(ms)` stops one frame (16.6 ms) short: `seek(500)` gives progress 0.483 and `seek(1000)` leaves
  the tween active at 0.983. Ask for `ms + 16.6`, or compare with a tolerance of one frame.
- [tested] `complete-leaves-target-midway`: `tween.complete()` fires `onComplete` but leaves the target where it was (x = 50 of 100). `tween.forward(5000)` runs it to the end value;
  `seek` also reaches the end but suppresses events. Skip a cutscene with `forward(tween.totalDuration)`, not `complete()`. On a tween created this frame, call it twice: the first call only starts it (`tween-forward-fresh-needs-two-calls`, [cutscenes](cutscenes.md)).
- [documented] A tween without `persist` is destroyed after it completes (state 28 once the manager has stepped), so read its end state from the target, or create the tween with
  `persist: true` in a test and call `remove()` afterwards (`src/tweens/TweenManager.js`, `step`).
- [documented] Assert an animation by frame name at a tick: `sprite.anims.currentFrame.textureFrame` and `sprite.anims.currentAnim.key`, after `step` calls of known length. Frame changes
  land on the first step whose accumulated time reaches the frame's duration, so with 10 ms steps a 100 ms frame changes on step ten.
- [general] Guard ease names and options with a sampling test: run the tween by hand to 25% and 75% and compare with the expected number; a typo is silent linear motion
  (`unknown-ease-is-linear`).

## Leaks and lifecycle

- [tested] `destroy-keeps-persisted-tween`, `follower-restart-leaks-tweens`, `anims-remove-leaks-listeners`: persisted tweens and animation listeners survive their owners. Assert
  `scene.tweens.getTweens().length` and `game.anims.listenerCount('pauseall')` return to a baseline after the scene object, follower or animation set is torn down.
- [general] Restart the scene ten times in the browser spec and fail on any growth in those two numbers plus the scene's timer count (`scene.time` has no public count; a test may read the
  underscore field `scene.time._active.length`). Add `tweens.getTweens().filter(t => t.isFinished())` to the report: finished entries should be empty.
- [general] Fail the spec on any console warning during a motion test: a missing animation, a missing texture frame and a duplicate key all arrive as `console.warn`, not exceptions.

## Related

[Clocks](clocks-timers-and-delta.md), [tweens](tweens-and-chains.md), [animations](sprite-animations.md), and the motion layer frame-diff recipe in
[ambient motion](../../phaser-worlds/references/ambient-motion.md).
