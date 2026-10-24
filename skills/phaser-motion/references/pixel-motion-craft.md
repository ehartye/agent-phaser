# Motion craft for pixel games (Phaser 4.2.1)

Choosing the motion tool and keeping it on the pixel grid. `[tested]` labels name checks in the [clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs)
(`node phaser-motion-clocks.mjs <project>`; the rounding check uses WebGL at camera zoom 1 on a software rasteriser). Screen-covering drift, particles and wind are in
[ambient motion](../../phaser-worlds/references/ambient-motion.md); interface slides at fractional scales are in
[pixel-perfect text and panels](../../phaser-pixel-ui/references/pixel-perfect-text-and-panels.md).

## Tween, animation, timeline, particle, shader

| Effect | Use | Because |
| --- | --- | --- |
| Move, fade or pop a few objects | tween, rounded in `onUpdate` | position stays continuous, display is whole pixels |
| Walk, attack, idle | sprite animation | frames are authored; per-frame milliseconds |
| Pickup bob, UI pulse | yoyo tween on `y` with `Stepped` or a rounded `onUpdate` | no sub-pixel blur |
| Hit flash | `setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)`, restore from `time.delayedCall` | no shader needed ([gotcha 6](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md)) |
| Bursts of short-lived bits | particle emitter ([phaser-worlds](../../phaser-worlds/SKILL.md)) | pooled; no tween per bit |
| Thousands of identical loops (grass, flags) | `SpriteGPULayer` member animations | one draw call, GPU time |
| Whole-object colour, wobble, dissolve | filter or shader ([phaser-rendering](../../phaser-rendering/SKILL.md)) | per-pixel work belongs on the GPU |
| Screen or scene transition | `camera.filters.external.addWipe(...)` plus a tween on `wipe.progress` | Phaser's filters skill; a filter controller is a plain tweenable object |
| Timed sequence of mixed steps | `add.timeline` | one object to pause and clear |

- [documented] `SpriteGPULayer` members take GPU-evaluated animations on `x`, `y`, `rotation`, `scaleX/Y`, `alpha` and `tintBlend`, with frame animations, a `creationTime` stagger
  and a `timeElapsed` clock that `setTimerPaused` can stop (`src/gameobjects/spritegpulayer/typedefs/Member.js`, `ElapseTimer.js`). Its eases include `Gravity` for
  hop and debris arcs (`EasingEncoding.js`, `SpriteGPULayer.js`). Editing members later rewrites buffer segments, so populate once.

## Whole-pixel motion

- [tested] `rotation-or-scale-drops-vertex-rounding`: with `pixelArt: true`, an `Image` at x = 10.5 is drawn from column 11. Give it a rotation of 0.0001 or a scale of 1.0001 and it
  is drawn from column 10: a one-pixel pop, because Phaser 4 rounds vertices only for objects that are translated and nothing else (`vertexRoundMode` `'safeAuto'`,
  `GameObject.willRoundVertices`). `setVertexRoundMode('full')` restored column 11 (vertices wobble on a real scale).
- [general] So a scale or angle tween can pop up to a pixel when it starts and again when it returns to exactly 1 or 0, whenever the object's position is fractional. Animate
  squash and stretch with art frames, or accept `'full'` rounding on that object for the duration; do not spin pixel art through small angles.
- [tested] `round-in-on-update`: rounding the target inside `onUpdate` shows whole pixels while the tween keeps its precise value (it ends at exactly 10 with no drift), because
  each frame recomputes the value from start, end and elapsed time instead of reading the target back (`TweenData.update`).
- [documented] `ease: 'Stepped', easeParams: [n]` makes `n` equal jumps. For an `n`-pixel move it gives one pixel per step with even spacing, the right ease for retro tick motion
  (`src/math/easing/stepped/Stepped.js`).
- [general] Short moves get few distinct positions: 6 px over 400 ms is 24 frames for 6 positions, so a strong ease parks on the last pixel for many frames. Use linear or quad
  out below about 8 px; avoid `Back`, `Elastic` and `Bounce` where the overshoot is under 2 px, because it rounds into jitter.
- [documented] Rounding is applied at render time and never changes the stored position (`docs/Phaser 4 Pixel Art Guide`), so the tween and any code that reads `x` still see the float.

## Impact effects

- [tested] `camera-shake-rounds-with-round-pixels`: with `camera.roundPixels` true (what `pixelArt: true` sets) the `camera.shake` offset is an integer; with it false it is fractional. The offset is
  then multiplied by the zoom a second time, so at integer zoom a rounded step moves the picture by a whole number of art pixels (at zoom 3 an offset of 10 moved the view 30 device pixels and the
  rendered picture by 30 and 21, both multiples of 3; the smallest step is one art pixel, not a third of one; `phaser-worlds-cameras.mjs` checks 6 and 6b). A rounded shake stays on the art grid and smears
  only with `roundPixels` false (`startFollow(target)` resets it unless you pass `true`) or a fractional zoom (the product is then not a whole number of device pixels; arithmetic, not probed).
- [documented] `Shake.update` includes `camera.zoom` in the offset and `Camera.preRender` applies it with `matrix.translate`, which multiplies by the zoom scale again (`src/cameras/2d/effects/Shake.js`,
  `src/gameobjects/components/TransformMatrix.js`). Shake is random each frame, so for a repeatable, hand-shaped decay use the follow-offset technique in
  [gotcha 12](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md).
- [tested] `hit-stop-time-scale-zero`: set `tweens.setGlobalTimeScale(0)` and `anims.globalTimeScale = 0`, skip the simulation step, and restore both scales from a scene-clock
  `delayedCall` that also resumes the step. Do not use `tweens.pauseAll()` for a hit stop under half a second ([clocks](clocks-timers-and-delta.md)).
- [general] Never scale the clock that restores the scale: keep `time.timeScale` at 1 during a hit stop or the restoring timer never fires.

## Reduced motion

- [tested] `reduced-motion-emulation`: `page.emulateMedia({ reducedMotion: 'reduce' })` makes `matchMedia('(prefers-reduced-motion: reduce)').matches` true, so a test can run the
  whole scene in the reduced state.
- [general] Read the query once into a settings object, listen for its `change` event, and let a player setting override it. Route every duration through it:

```ts
export const motion = {
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  ms: (duration: number) => (motion.reduced ? Math.min(duration, 80) : duration),
};
scene.tweens.add({ targets: panel, alpha: 1, duration: motion.ms(250) });
if (!motion.reduced) scene.cameras.main.shake(120, 0.004);
```

- [general] Reduced means: no shake, no parallax drift, no looping ambient motion, no large position tweens (cut or crossfade instead), shorter state changes. Keep feedback that
  carries meaning (a colour change, a blink) and keep rules unchanged: motion settings must not alter the simulation.

## Related

[Tweens](tweens-and-chains.md), [animations](sprite-animations.md), [clocks](clocks-timers-and-delta.md).
