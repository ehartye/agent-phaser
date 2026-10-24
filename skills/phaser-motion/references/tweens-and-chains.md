# Tweens, chains and number tweens (Phaser 4.2.1)

What `scene.tweens` offers in 4.2.1, which tool to pick, and the behaviours that cost hours. A `[tested]` label names a check in the
[clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs) (`node phaser-motion-clocks.mjs <project> [<4.2.0 package>]`).
Phaser's own reference is `node_modules/phaser/skills/tweens/SKILL.md`; this page does not repeat it.

## Which tool

| You want | Use | Watch for |
| --- | --- | --- |
| Properties to glide | `tweens.add` | runs on wall time, not scene time ([clocks](clocks-timers-and-delta.md)) |
| Steps in sequence on the same targets | `tweens.chain({ targets, tweens: [...] })` | chain options: `delay`, `loop`, `loopDelay`, `completeDelay`, `paused`, `persist` |
| A script of callbacks, sounds and tweens at times | `this.add.timeline([...])` | starts paused: call `play()` |
| A number, not an object | `tweens.addCounter({ from, to })`, then `tween.getValue()` | what `PathFollower` uses internally |
| An offset per target | `delay: tweens.stagger(50, { from: 'center' })` | needs several targets |
| Thousands of identical loops | `SpriteGPULayer` member animations ([pixel motion](pixel-motion-craft.md)) | WebGL only |

- [documented] Phaser 3's `tweens.timeline()` is gone: `src/tweens/TweenManager.js` offers `add`, `addMultiple`, `create` + `existing`, `chain`, `addCounter`,
  `stagger`, `killAll`, `killTweensOf`, `pauseAll`, `setGlobalTimeScale`, `setFps`, `setLagSmooth`. Timed scripts are `Phaser.Time.Timeline` (`src/time/Timeline.js`).
- [tested] `timeline-array-order`: a Timeline follows the scene clock but fires due events in array order, not time order. Add events earliest first.
- [documented] A `tween:` event calls `sys.tweens.add` when it fires, so it is an ordinary wall-clock tween (`Timeline.update`).

## Config that matters

- [documented] Defaults: `duration` 1000, `ease` `'Power0'` (linear), `repeat` 0, `delay` 0 (`src/tweens/tween/Defaults.js`). `repeat` is per property, `loop` restarts the
  whole tween, `hold` waits at the end before a yoyo, and a config with `props` ignores its top-level properties.
- [tested] `loop-replays-delay-repeat-does-not`: `delay` runs again on every `loop` and never on `repeat`. Use `repeatDelay` and `loopDelay` for pauses between cycles.
- [documented] Values: a number, `'+=50'` (also `-=`, `*=`, `/=`), `'random(10, 20)'`, `'int(1, 5)'`, an array (interpolated), a function
  `(target, key, value, index, total, tween)`, `{ from, to }` or `{ start, from, to }` (`src/tweens/builders/GetValueOp.js`).
- [tested] `relative-end-resolved-late`: start and end are read when that property's delay ends. `x: '+=100'` after a 200 ms delay is relative to where the object is then.
- [tested] `unknown-ease-is-linear`: `'Sine.easeInOutt'` falls back to linear with no warning; `'Sine.easeInOut'` and `'sine.inout'` both work. Sample the value
  at 25% in a test to guard an ease name.
- [documented] `ease: 'Stepped', easeParams: [4]` yields 0.25, 0.5, 0.75, 1 and never 0 after the first instant (`src/math/easing/stepped/Stepped.js`).
- [general] Two tweens on one property overwrite each other every frame. Call `tweens.killTweensOf(target)` before starting a replacement.

## Callbacks and events

- [tested] `update-argument-order`: the config callback `onUpdate` gets `(tween, target, key, current, previous)`; a `tween.on('update')` listener gets
  `(tween, key, target, current, previous)`, with key and target swapped. `start`, `loop` and `complete` get `(tween, targets)`.
- [documented] `onUpdate`, `onYoyo` and `onRepeat` run once per property per target per frame (`TweenData.update`), so a tween on `x` and `y` of ten targets calls
  `onUpdate` twenty times a frame.
- [tested] `manual-tween-update`: the first `update()` of a tween only starts it (the delta is zeroed, `BaseTween.updateStartCountdown`), so a 1000 ms tween
  needs 1000 ms of updates after that one.
- [documented] `loop: -1` and `repeat: -1` never fire `onComplete`; `completeAfterLoop(0)` ends the run after the current loop.

## Lifetime, cleanup and cost

- [tested] `kill-all-skips-on-complete`: `killAll()` and a scene shutdown destroy tweens without `onComplete`. Never put cleanup that must run in `onComplete`.
- [tested] `destroyed-target-still-completes`: destroying a target mid-tween ends the tween silently and still calls `onComplete` once. Guard callbacks with
  `if (!target.active) return`.
- [tested] `destroy-keeps-persisted-tween`: `persist: true` keeps a finished tween in the manager, and `destroy()` does not remove it (it flips back to
  finished). Call `tween.remove()` to drop it. `killTweensOf` calls `destroy()` and `stop()` only marks it finished, so both leave the entry; a restarted
  `PathFollower` leaks one per start ([curves](curves-paths-and-followers.md)).
- [documented] Tweens are not pooled: each `add` builds a `Tween`, one `TweenData` per property per target and closures per property
  (`src/tweens/builders/TweenBuilder.js`, `GetValueOp.js`).
- [general] For many short effects use one `addCounter` that drives an array, a reused `persist: true` tween with `restart()`, or a particle emitter.
- [documented] The manager samples at most 240 times a second (`gap = 1000 / 240`) and lag-smooths gaps above 500 ms down to 33 ms
  (`TweenManager.js`); `setFps` and `setLagSmooth(limit, skip)` change both.
- [tested] `date-now-patch-drives-tweens`: replacing `Date.now` with a virtual clock makes tweens follow `game.step`; see [verifying motion](verifying-motion.md).

## Version-sensitive: TweenChain `delay`

- [tested] `chain-delay-4.2.0-stuck`: on 4.2.0 a `tweens.chain({ delay })` fires `onStart` and then stays in state 24 (`START_DELAY`) forever; the first child never
  runs. `chain-delay-4.2.1`: fixed in 4.2.1 (changelog: "Tweens with a startDelay set weren't having their state updated from START_DELAY to ACTIVE").
- [documented] Plain `tweens.add({ delay })` was never affected: only `TweenChain.init` and `play` enter `START_DELAY` (`src/tweens/tween/TweenChain.js`).
- [general] On a 4.2.0 pin, put the delay on the first child tween, or create the chain with `paused: true` and call `play()` from a `time.delayedCall`.

## Related

[Clocks](clocks-timers-and-delta.md), [verifying motion](verifying-motion.md), [pixel motion](pixel-motion-craft.md).
