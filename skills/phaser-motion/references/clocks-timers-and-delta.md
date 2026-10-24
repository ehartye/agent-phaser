# Clocks, timers and delta time (Phaser 4.2.1)

Phaser 4.2.1 runs motion on more than one clock, and the difference decides whether pause, slow motion, replay and tests work. `[tested]` labels name checks in the
[clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs) (`node phaser-motion-clocks.mjs <project>`). The fixed-step loop that rules must use is in
[scenes, loop and plugins](../../engine-phaser/references/scenes-loop-and-plugins.md).

## Which clock drives what

| System | Advances by | Follows `game.step(t, dt)` | Freeze it with |
| --- | --- | --- | --- |
| Tweens, `TweenChain`, `addCounter`, `PathFollower` | `Date.now()` difference, sampled each frame | no | `tween.pause()`, `tweens.setGlobalTimeScale(0)` |
| `time.addEvent`, `delayedCall` | scene delta | yes | `time.paused`, `event.paused`, `time.timeScale` |
| `add.timeline` | scene delta | yes | `timeline.pause()` |
| Sprite animations | scene delta | yes | `sprite.anims.pause()`, `anims.globalTimeScale = 0` |
| `SpriteGPULayer` members | `timeElapsed` += delta | yes | `layer.setTimerPaused(true)` |
| Camera shake | delta given to the effect | yes | `camera.shakeEffect.reset()` |
| Arcade physics | its own fixed steps from the delta | yes | [phaser-physics](../../phaser-physics/SKILL.md) |

- [tested] `tween-wall-clock`: 1167 ms of `game.step` fired a 500 ms timer and ran a 10 fps animation for eleven frames, while a 1000 ms tween stayed at progress 0. The
  source is `TweenManager.getDelta`, which ignores the delta its `update` hook receives (`src/tweens/TweenManager.js`).
- [documented] The other rows read the scene delta: `Clock.update` (`src/time/Clock.js`), `Timeline.preUpdate` (`src/time/Timeline.js`), `AnimationState.update`,
  `ElapseTimer.updateTimer` (`src/gameobjects/components/ElapseTimer.js`), `Shake.update` (`src/cameras/2d/effects/Shake.js`).
- [documented] Every system has its own time-scale knob and none propagates: `time.timeScale`, `TimerEvent.timeScale`, `tweens.setGlobalTimeScale`, `Tween.timeScale`,
  `anims.globalTimeScale`, `sprite.anims.timeScale`, `timeline.timeScale`, emitter `timeScale`. Arcade `world.timeScale` is inverted: above 1 is slower
  (`src/physics/arcade/World.js`, `msPerFrame = _frameTimeMS * timeScale`). Slow motion must set every one the scene uses.

## Delta smoothing

- [tested] `timestep-smoothing`: `smoothStep` is on by default with a ten-frame mean (`deltaHistory`). A single 100 ms hitch arrives as ten frames of 25 ms, so total time is kept
  but spread out. A 150 ms frame arrives as 30 ms for ten frames.
- [tested] A delta above 200 ms (`1000 / min`, min fps 5) is replaced by the oldest value in the window (16.67 ms), so a stall longer than 200 ms loses its time. Do not
  expect a time-based system to catch up after a stall.
- [tested] For the first 120 frames after start, focus or resume (`panicMax`), and for every frame while `inFocus` is false, each delta is capped at `1000 / target`
  (16.67 ms).
- [general] On a display running below 60 Hz that cap is slow motion: 120 frames at 30 Hz is four seconds after a tab returns.
- [tested] `fps: { smoothStep: false }` passes the raw delta through. A fixed-step accumulator wants that plus its own clamp (the `FixedStepper` in the loop reference).
  `game.step(time, delta)` never smooths at all.
- [documented] Config keys are `fps.min`, `fps.target`, `fps.deltaHistory`, `fps.panicMax`, `fps.smoothStep`, `fps.limit`, `fps.forceSetTimeOut`
  (`src/core/typedefs/FPSConfig.js`). `TimeStep.blur()` only clears `inFocus`; a blurred window keeps running at the capped delta.

## Frame-rate limit (4.2.0)

- [tested] `fps-limit`: `loop.setFPSLimit(30)` updates `hasFpsLimit` and the derived 33.33 ms rate, and fed 60 Hz timestamps it calls the game every second frame with
  delta 33.33. Assigning `loop.fpsLimit` directly leaves the derived rate stale (4.2.0 changelog). `setFPSLimit(0)` removes the limit.
- [documented] Phaser's own note: a limit only helps when you want to drop the rate below the display's (`FPSConfig#limit`). It throttles the whole step, so update and
  render both run at the limit, while tweens still measure real time. 4.0 changed the limiter to drop fewer frames (`CHANGELOG-v4.0.0.md`).

## Timers

- [tested] `timer-semantics`: `repeat: 2` fires three times; `loop: true` repeats forever; `delayedCall(0, fn)` fires on the next frame, not synchronously; a zero-delay loop
  throws `TimerEvent infinite loop created via zero delay`; `time.paused` and `event.paused` stop callbacks while `time.now` keeps following the loop, and a paused scene stops them too;
  `timeScale: 2` doubles the rate.
- [tested] A 10 ms loop timer fired 100 times in one frame given a 1000 ms delta (`Clock.update` replays missed intervals).
- [general] Through the real loop, smoothing spreads a 200 ms hitch over ten frames (about three callbacks a frame); with `smoothStep: false` or a manual `game.step` the whole burst
  lands in one frame, so keep timer callbacks cheap.
- [documented] New events join the clock at the next `PRE_UPDATE` and `remove()` is applied then too; a scene shutdown destroys every event without calling it
  (`Clock.preUpdate`, `shutdown`). `Clock.now` is the loop time, set before the pause check, so it is not a frozen presentation counter.
- [general] Timers are for presentation: flash lengths, UI hide delays, view cooldowns. Rule timing (cooldowns, spawns, AI) counts simulation ticks, because a timer's firing frame
  depends on the display rate and breaks replay.

## Pause, hit stop and slow motion

- [tested] `short-pause-catches-up`: after `tweens.pauseAll()` or `scene.sleep()` lasting 300 ms, the tweens jump the whole 300 ms on resume; after 800 ms they
  jump only 33 ms. `getDelta` keeps sampling the wall clock and only discards gaps over 500 ms. `tween.pause()` and `setGlobalTimeScale(0)` freeze cleanly at any length.
- [tested] `hit-stop-time-scale-zero`: `tweens.setGlobalTimeScale(0)` plus `anims.globalTimeScale = 0` held a tween and a looping sprite for 200 ms; a `time.delayedCall`
  (scene clock, not scaled) restored both. The fixed-step side of a hit stop (skip the step, reuse the last alpha) is in the loop reference.
- [general] Count overlapping hit stops with a token, so an old timer cannot restore the scales while a newer hit stop is still running.
- [documented] A paused scene emits no `UPDATE`, the only trigger of `TweenManager.update`, so a scene pause behaves like `pauseAll` for tweens.
- [documented] A hidden tab pauses `TimeStep` (`Game.onHidden` and `onVisible`); on return the delta resets and the 120-frame cap applies. Blur alone does not pause: hold the
  loop yourself ([gotcha 15](../../phaser-rendering/references/phaser-4-webgl-context-gotchas.md)).

## Which clock for what

| You are timing | Use | Why |
| --- | --- | --- |
| A rule (cooldown, spawn, AI, fuse) | simulation ticks | identical on replay and at any display rate |
| A view delay (flash, auto-hide, toast) | `time.delayedCall` | pauses with the scene |
| A glide or fade | tween | wall time; freeze with a time scale |
| A flipbook | sprite animation | scene time; speed with `timeScale` |
| A mixed script | `add.timeline` | scene time; keep its `tween:` events short |
| A test that must be exact | a fake or virtual clock ([verifying motion](verifying-motion.md)) | tweens need it patched |
| Wall time outside the world (autosave debounce, network timeout) | `setTimeout`, `performance.now` | never inside rules |

- [general] Choose by what must happen on pause and in a test: whatever freezes with the scene lives on scene time, and whatever a test must make exact must share the clock the test drives.

## Related

[Tweens](tweens-and-chains.md), [sprite animations](sprite-animations.md), [verifying motion](verifying-motion.md).
