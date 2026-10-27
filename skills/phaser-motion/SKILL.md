---
name: phaser-motion
description: Move things in a Phaser 4 game - tweens and chains, sprite animations and Aseprite tags, timers and the scene clock, delta smoothing and the frame-rate limit, paths and followers, whole-pixel motion, hit stop, screen shake, reduced motion, scene transitions and Timeline cutscenes - and test motion exactly. Use when writing or debugging this.tweens.add, tweens.chain, add.timeline, scene.transition, anims.create, createFromAseprite, delayedCall, time.addEvent, PathFollower, a scene change that fades or passes data, a cutscene to script, pause or skip, a pause or slow-motion effect, a tween that ignores game.step, an animation stuck on one frame, or pixel art that jitters while it moves. Not for Arcade or Matter bodies and steering (phaser-physics), particles, weather, lights or cameras (phaser-worlds), shaders and filters (phaser-rendering), scene lifecycle and fixed-step rules (engine-phaser) or real-GPU capture and profiling (phaser-verification).
---

# Phaser motion

Phaser 4.2.1 moves things with tweens, sprite animations, clock timers, timelines and path followers. They do not share a clock, and that decides whether pause, slow motion,
replay and tests work. Read the reference that matches the work. Phaser's own agent docs (`node_modules/phaser/skills/tweens`, `animations`, `time-and-timers`,
`curves-and-paths`) give the API; these pages give the decisions, numbers and traps they leave out.

| You are about to | Read |
| --- | --- |
| Pick a tween, chain, counter, timeline or stagger; clean tweens up; hit the 4.2.0 chain-delay bug | [tweens and chains](references/tweens-and-chains.md) |
| Change scenes with `scene.transition`: events, data, input during it, sleep or remove the old scene | [scene transitions](references/scene-transitions.md) |
| Script, pause, skip or test a cutscene with `add.timeline` | [cutscenes](references/cutscenes.md) |
| Load Aseprite tags, set frame timing, switch animations, or evict them | [sprite animations](references/sprite-animations.md) |
| Time anything: timers, `time.timeScale`, delta smoothing, `fps.limit`, pause, hit stop, slow motion | [clocks, timers and delta](references/clocks-timers-and-delta.md) |
| Move along a curve, place evenly spaced points, restart a `PathFollower` | [curves, paths and followers](references/curves-paths-and-followers.md) |
| Keep motion on the pixel grid, choose tween or animation or particle, shake, flash, honour reduced motion | [pixel motion craft](references/pixel-motion-craft.md) |
| Assert a pose, an animation frame or a leak; drive a scene on a fake or virtual clock | [verifying motion](references/verifying-motion.md) |

## Rules that earned their place

- [tested] **Tweens and path followers run on the wall clock; everything else runs on scene time.** `TweenManager` reads `Date.now()` and ignores the delta it is given, so a
  hand-driven `game.step` loop moves timers and animations but not tweens, and a 300 ms `tweens.pauseAll()` or `scene.sleep()` is caught up on resume (gaps over 500 ms are cut to
  33 ms). Freeze with `tweens.setGlobalTimeScale(0)` or `tween.pause()`; test with `page.clock.runFor`. Probe checks: `tween-wall-clock`, `short-pause-catches-up`,
  `page-clock-drives-tweens`.
- [general] **Rules count simulation ticks; tweens, timers and animation events are view-only.** Their firing frame depends on the display rate, `timeScale` and delta
  smoothing, so a rule that waits on one breaks replay and saves. Timers are for flashes and UI delays.
- [tested] **Phaser smooths `delta`, and drops long stalls.** The default is a ten-frame mean: a 100 ms hitch arrives as ten frames of 25 ms; a frame over 200 ms is replaced by an
  older value, so its time is lost; the first 120 frames after start, focus or resume (and every blurred frame) cap each delta at 16.67 ms. `fps: { smoothStep: false }` passes
  the raw delta; `game.step` never smooths. Probe check: `timestep-smoothing`.
- [tested] **Start an animation once, never every frame.** `sprite.play(key)` on each update restarts it, so the sprite sits on frame 0; use `play(key, true)`. A per-frame
  `duration` replaces `msPerFrame` (Phaser's bundled doc says it is added: it is not). `createFromAseprite` builds `repeat: 0` animations, so a walk cycle plays once and freezes
  unless you `play({ key, repeat: -1 })`. Change speed with `timeScale`: a different `frameRate` drops the durations and `play({ duration })` is ignored. Probe checks:
  `play-every-frame-restarts`, `per-frame-duration-replaces`, `aseprite-defaults`.
- [tested] **Clean up what persists.** A `persist: true` tween stays in the manager after it finishes, `destroy()` does not remove it (use `tween.remove()`), and every
  `PathFollower.startFollow` leaves one behind. `anims.remove(key)` leaks listeners (use `anim.destroy()`). A scene shutdown or `killAll` skips `onComplete`, and a destroyed
  target still gets one. Probe checks: `destroy-keeps-persisted-tween`, `follower-restart-leaks-tweens`, `anims-remove-leaks-listeners`.
- [tested] **On pixel art, translate; do not rotate or scale a tween through small values.** Phaser 4 snaps only translated objects (`vertexRoundMode: 'safeAuto'`), so a rotation
  of 0.0001 or a scale of 1.0001 moves a sprite at x = 10.5 by a whole pixel. Round inside `onUpdate`; draw squash and stretch as art frames. Probe checks:
  `rotation-or-scale-drops-vertex-rounding`, `round-in-on-update`.
- [tested] **Several calls fail quietly.** An unknown ease name is linear, an Aseprite frame without `duration` never advances, `tween.complete()` fires `onComplete` but leaves the
  target mid-way, `Path.getPoint` returns `null` past 1, and `seek(ms)` lands a frame short. Assert eases, durations and end values in tests. Probe checks:
  `unknown-ease-is-linear`, `aseprite-missing-duration-freezes`, `complete-leaves-target-midway`.

## Version

- [tested] **4.2.0 `tweens.chain({ delay })` never plays**: it fires `onStart` and stays in `START_DELAY` (state 24). Fixed in 4.2.1 (Phaser issue 7093). Pin 4.2.1 and
  check with `chain-delay-4.2.0-stuck`. `Timestep#setFPSLimit` arrived in 4.2.0 (`fps-limit`); plain `tweens.add({ delay })` was never affected.

## Probe

- [tested] `node examples/web/phaser-probes/phaser-motion-clocks.mjs <project with phaser 4.2.1 and playwright> [<phaser 4.2.0 package>]` runs 39 checks (38 without the 4.2.0 package) in about thirteen
  seconds on Chromium with a software rasteriser; each reference's `[tested]` label names its check. The checks cover logic, not GPU correctness or speed.

## Not covered here

Bodies, velocity, steering and tilemap collision: [phaser-physics](../phaser-physics/SKILL.md). Particles, weather, lights, camera follow and ambient layers:
[phaser-worlds](../phaser-worlds/SKILL.md). Filters, shaders, `SpriteGPULayer` internals and context loss: [phaser-rendering](../phaser-rendering/SKILL.md). The fixed-step
accumulator and scene lifecycle: [engine-phaser](../engine-phaser/SKILL.md). Pixel-exact interface slides: [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md). Real-GPU runs,
profiling and frame budgets: [phaser-verification](../phaser-verification/SKILL.md). Input timing: [phaser-input](../phaser-input/SKILL.md).
