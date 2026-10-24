# Sprite animations in Phaser 4.2.1

How frame animations are timed, what `createFromAseprite` really builds, and the mistakes that freeze or restart a sprite. `[tested]` labels name checks in the
[clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs) (`node phaser-motion-clocks.mjs <project>`). Phaser's own reference is
`node_modules/phaser/skills/animations/SKILL.md`; where this page contradicts it, this page was run.

## Definitions and playback state

- [documented] `this.anims` is the game-wide `AnimationManager`: definitions survive scene restarts and are shared by every scene. `sprite.anims` is the per-sprite
  `AnimationState`; `sprite.anims.create` makes a local definition that wins over a global one with the same key (`src/animations/AnimationState.js`, `load`).
- [documented] A sprite animates from `Sprite.preUpdate`, called on the scene update list in `PRE_UPDATE` with the scene's smoothed delta
  (`src/gameobjects/sprite/Sprite.js`, `src/gameobjects/UpdateList.js`). So animations follow `game.step`, freeze with the scene, and run before timers and tweens
  in the same frame (`src/scene/Systems.js`). An `Image` has no animation state.
- [general] Hundreds of simple looping decorations are cheaper as `Image`s that one shared clock re-frames with `setFrame` than as `Sprite`s each with playback state.

## Frame timing rules

- [tested] `per-frame-duration-replaces`: a frame's own `duration` replaces `msPerFrame` for that frame; it is not added. At `frameRate: 10` with durations 300, none, 50, none,
  the frames change at 300, 400 and 450 ms. Phaser's bundled animations skill says "additive": that is wrong for 4.2.1 (`Animation.getNextTick`).
- [tested] `frame-rate-override-drops-durations`: `play({ key, frameRate: 20 })` with a rate different from the definition's discards every per-frame duration and ticks
  uniformly (50 ms). Change speed with `timeScale`: `time-scale-keeps-proportions` (a 2x `timeScale` halves every frame time).
- [tested] `play-config-duration-ignored`: `play({ key, duration: 4000 })` changes nothing, because the definition already has a `frameRate` and a frame rate beats a duration
  (`Animation.calculateDuration`). Only `anims.create({ frames, duration })` with no `frameRate` derives the rate from a duration.
- [documented] With neither given, the rate is 24 fps. `skipMissedFrames` (default true) advances up to about 60 frames in one update to catch up, and the remainder carries
  over (`AnimationState.update`, `getNextTick`), so average speed is right at any display rate.
- [general] Author pixel-art timing in milliseconds per frame (Aseprite durations) and speed it up with `timeScale` on the sprite or `anims.globalTimeScale`; where frames
  carry their own durations, never retime with `frameRate`.

## Aseprite sheets (`load.aseprite` then `createFromAseprite`)

- [tested] `aseprite-defaults`: every tag becomes a definition with `repeat: 0`, so a walk cycle plays once and freezes on its last frame. Loop it with
  `sprite.play({ key: 'walk', repeat: -1 })`. Tag direction `pingpong` sets `yoyo`; `reverse` reverses the frames; `pingpong_reverse` is treated as plain forward (no yoyo).
- [documented] Frames are read as `frames[String(index)]` and skipped silently when missing (`src/animations/AnimationManager.js`, `createFromAseprite`), so the atlas JSON
  must key its frames by index. The texture must hold a frame with each of those names or Phaser warns and drops it.
- [tested] `aseprite-missing-duration-freezes`: a frame without `duration` counts as `MAX_SAFE_INTEGER` ms, giving a definition that never advances. Validate the JSON
  (every frame has a positive `duration`) before loading.
- [documented] Tag names become global keys and a second atlas with the same tag creates nothing: see
  [gotcha 5](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md) for the namespacing fix. The pivot slice is ignored; see
  [asset wiring](../../engine-phaser/references/asset-wiring.md).

## Playing, switching and events

- [tested] `play-every-frame-restarts`: calling `sprite.play('walk')` on every update restarts it each time, so the sprite sits on frame 0 and emits `animationstop` each frame.
  Use `play(key, true)` (ignore if already playing), or change the animation only when the wanted key changes.
- [tested] `animation-overrides-texture-swap`: while an animation plays, every frame change writes the frame's own texture back to the sprite, so `setTexture('other')` lasts until
  the next frame. Swap costumes by playing a variant animation built from the other texture (key it `<variant>:<tag>`), or stop the animation and set frames yourself.
- [documented] Events are emitted on the sprite with `(animation, frame, gameObject, frameKey)`: `animationstart`, `animationupdate`, `animationrepeat`, `animationstop`,
  `animationcomplete` and `animationcomplete-<key>`. A `repeat: -1` animation never completes; `stop()` fires `animationstop` instead, and chained animations start after either.
- [general] Keep animation callbacks cosmetic. Hit windows, damage frames and state changes belong to the simulation's ticks; the view reads sim state and picks the
  frame (`sprite.anims.setProgress(p)` or `setFrame`). A rule that waits for `animationcomplete` changes with the frame rate, the display rate and `timeScale`.

## Memory and cleanup

- [tested] `anims-remove-leaks-listeners`: each `Animation` subscribes to `pauseall` and `resumeall` on the manager. `anims.remove(key)` leaves those listeners behind
  (20 create/remove cycles left 20 extra `pauseall` listeners); `anims.get(key).destroy()` removes them. Evict runtime-built animations with `destroy()`.
- [general] An animation keeps references to its `Frame` objects (`AnimationFrame.frame`), so destroy it before removing its texture; the pin-by-count rule for runtime
  textures is in [performance](../../phaser-verification/references/performance.md).
- [documented] `anims.pauseAll()` flags every definition (`Animation.paused`), pausing every sprite that plays it; for a freeze that can be undone per scene use
  `anims.globalTimeScale = 0` (`hit-stop-time-scale-zero` holds a looping sprite on one frame with it).

## Related

[Tweens](tweens-and-chains.md), [clocks](clocks-timers-and-delta.md), [pixel motion](pixel-motion-craft.md). Tile animations are
[phaser-worlds](../../phaser-worlds/SKILL.md); `SpriteGPULayer` frame animations are [phaser-rendering](../../phaser-rendering/SKILL.md).
