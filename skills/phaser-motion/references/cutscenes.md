# Cutscenes with `add.timeline` (Phaser 4.2.1)

A Timeline is a list of timed steps on the scene clock: callbacks, state changes, sounds, tweens and named events. How the steps fire, how to pause, stop and skip one, and what to do about its one wall-clock part. Other timing tools are in [tweens and chains](tweens-and-chains.md) and [clocks, timers and delta](clocks-timers-and-delta.md). Check ids are in `phaser-motion-scenes.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md).

## Steps and timing

- [documented] `this.add.timeline([{ at, run, set, target, tween, sound, event, if, once, stop }, ...])` (`src/time/Timeline.js`). Each step fires once when its `at` time has passed, doing in this order: `if` (a false result skips the rest), `set` on `target`, `tween`, `sound`, `event` (emitted on the timeline), `run`, then `stop`. `once: true` removes the step after it fires. A timeline starts paused: call `play()`.
- [tested] Steps fire on the scene clock in array order (`timeline-fires-on-scene-clock`). With hand-stepped 16.67 ms frames a step at 0 fired on frame 1 and one at 100 ms on frame 6; a failing `if` skipped its `run`; `set` wrote to the target; the named `event` reached a timeline listener with the target; the `once` step was the only one removed (6 of 7 steps stayed); and `stop: true` ended the timeline so the step after it never ran. Add steps earliest first ([tweens and chains](tweens-and-chains.md)).
- [tested] A timeline reports not playing until `play()`, and `getProgress()` reached 1 at the end.

## Pause, resume, stop

- [tested] `pause()` held `elapsed` exactly (0 ms gained over 30 frames), `resume()` continued from there and fired the next step, and `stop()` fired nothing: it set `complete` and `paused` and left later steps unfired (`timeline-pause-resume-stop`). A cutscene that must survive a pause menu pauses the timeline, not the scene clock.

## Repetition and reset

- [tested] `timeline-repeat-boundaries` measures `repeat(0)`, `repeat(1)` and `repeat(2)` as one, two and three complete passes. An event's `loop` callback runs before its `run` on repeated passes only: zero, one and two calls respectively. Both callbacks use the event target when supplied. The 20-ms fixture takes two 10-ms steps per pass.
- [tested] `repeat(-1)` remains active: the probe stops after three passes, then verifies five further steps produce no callbacks. `repeat(-2)` instead completes after one pass with no loop callback. Do not generalize the pinned source documentation's “negative means infinite” wording to every negative value; only `-1` is qualified here. The probe records complete/paused/iteration states and exact callback order independently of those source comments.
- [tested] `once: true` executes on the first pass and is removed. `reset()` clears elapsed time, iteration and remaining event repeat counters, resumes the timeline, and does not recreate removed once events. Each repeat row is then reset with `repeat(0)` and runs once without a loop callback or the removed event (`timeline-repeat-boundaries`). Rebuild the timeline if the once event must return.
- [tested] `--mutation repeat-count` changes the native first case to `repeat(1)` while retaining the independent one-pass expectation; the actual callback-count/order comparison fails. `--out <directory>` retains traces and cleanup alongside the existing eleven checks. This is scene-clock behavior, not a wall-clock tween or hardware-performance result.

## Skipping

- [tested] `stop()` leaves every later step unfired (`timeline-skip`), so it cancels a cutscene and does not finish it. To skip to the end set `timeline.timeScale = 1e6` and step one frame: every remaining step fires in array order in that one update and `complete` becomes true. Do the final state changes in `run` and `set` steps, not in tweens, so a skip lands them.
- [tested] A `tween:` step fired by the skip is a real tween that has not moved (x 0 of 100). `tween.forward(tween.totalDuration)` does nothing the first time on a fresh tween, a timeline's or a plain `tweens.add`: the first call only starts it and the second lands it on the end value (`tween-forward-fresh-needs-two-calls`). Reach a timeline's tweens through `timeline.events[i].tweenInstance`. `tween.complete()` leaves the target midway ([verifying motion](verifying-motion.md)). This recipe skipped a whole cutscene in one frame (`timeline-skip`):

```js
this.events.once('postupdate', () => {            // the end of the frame that fires the skipped steps
  for (const e of timeline.events) { const t = e.tweenInstance; if (t) { t.forward(t.totalDuration); t.forward(t.totalDuration); } }
});
timeline.timeScale = 1e6;                          // every remaining step fires, in array order, in the next update
```

## Tests and determinism

- [tested] A `tween:` step is an ordinary wall-clock tween: after 90 hand-stepped frames (1.5 s of scene time) the timeline had run its whole 1.5 s but the target was still at x 0 (`timeline-tween-event-is-wall-clock`). A hand-driven test moves the steps, not the tweens.
- [tested] Under Playwright's fake clock (`page.clock.install` and `pauseAt` before the game exists, then `runFor`; installed without pausing, two runs differed) the same timeline, tween step included, was identical in two runs: about half way at 500 ms (46.4 of 100, as fake-clock frames are discrete) and exactly 100 with the final `run` step fired after 1500 ms (`timeline-under-page-clock`).
- [general] Keep rules and state in `run` and `set` steps (scene time, testable with `game.step`) and use `tween:` steps only for visuals, or test the cutscene under the fake clock. A cutscene driven from a replayable simulation should not depend on either: use the sim's own tick counter ([clocks, timers and delta](clocks-timers-and-delta.md)).
