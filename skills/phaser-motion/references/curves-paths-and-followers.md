# Curves, paths and path followers (Phaser 4.2.1)

Moving things along a curve: which call returns evenly spaced points, how long cached lengths stay wrong, and why a `PathFollower` is decoration rather than gameplay.
`[tested]` labels name checks in the [clock probe](../../../examples/web/phaser-probes/phaser-motion-clocks.mjs) (`node phaser-motion-clocks.mjs <project>`). Phaser's own reference
is `node_modules/phaser/skills/curves-and-paths/SKILL.md`. Physics-side steering and pathfinding live in [phaser-physics](../../phaser-physics/SKILL.md).

## Pick the primitive

| You want | Use | Why |
| --- | --- | --- |
| A straight eased slide | a tween on `x` and `y` | no curve needed |
| Constant speed along a curve, owned by the rules | the sim keeps distance `s`; the view reads `path.getPoint(s / path.getLength())` | replayable, no wall clock |
| A cosmetic mover (flag, boat, background bird) | `add.follower` and `startFollow` | one call; wall-clock tween |
| Evenly placed markers or waypoints | `curve.getSpacedPoints(n)` or `getDistancePoints(px)` | arc-length spacing |
| A camera rail | sample `path.getPoint` each update and call `camera.centerOn` | the camera stays on the frame clock |

- [general] Anything the rules care about is the sim-owned form; a follower is for decoration the rules never read, because its position depends on real time and cannot be replayed.

## Which call returns what

- [documented] `Curve.getPoint(t)` uses the curve's own parameter; `getPointAt(u)` maps arc length to `t` first (`Curve.getUtoTmapping`, `src/curves/Curve.js`). `Path.getPoint(t)` is
  already arc-length based across the whole path: it finds the owning curve by cumulative length and calls its `getPointAt` (`src/curves/path/Path.js`), so a linear
  progress is constant speed.
- [tested] `get-points-not-evenly-spaced`: on a cubic Bezier the longest and shortest of ten `getPoints(10)` segments differ by 1.8x, against 1.04x for `getSpacedPoints(10)`.
  Both return `divisions + 1` points. Use `getSpacedPoints` for anything a player can see the spacing of.
- [tested] `path-get-point-null`: `Path.getPoint` returns `null` for `t` above 1 and for a path with no curves. Clamp `t`, and build the path before the first read.
- [documented] Lengths are a polyline of `arcLengthDivisions` (default 100) samples per curve (`Curve.getLengths`). Raise it on a curve spanning thousands of pixels before the
  first `getLength()`.
- [tested] `arc-length-cache-needs-curve-update`: after you move a spline's control point, `path.getLength()` stays at the old 244 even after `path.updateArcLengths()`, and
  becomes 909 only after `curve.updateArcLengths()` and then `path.updateArcLengths()`. Update the curve first, then the path.

## PathFollower

- [tested] `follower-is-a-persist-counter-tween`: `startFollow` creates an `addCounter` tween with `persist: true`, so a follower runs on the wall clock and does not move under
  `game.step` ([clocks](clocks-timers-and-delta.md)).
- [documented] The tween's eased value is the path progress (`Components/PathFollower.pathUpdate`), so a non-linear `ease` varies speed. For a speed in pixels per second use a
  linear ease and `duration = path.getLength() / speed * 1000`.
- [tested] `follower-restart-leaks-tweens`: every `startFollow` leaves the previous finished counter tween in `scene.tweens`, and `stopFollow()` or destroying the follower does not
  remove it; ten restarts left ten. Call `follower.pathTween?.remove()` before each `startFollow` and in the follower's own teardown.
- [documented] With `rotateToPath` the initial rotation faces the point at 10% of the path, not the tangent at 0, and the rotation is skipped for one frame after a yoyo reverses
  (`pathUpdate`, `_prevDirection`). Pixel-art sprites should not rotate: quantise `path.getTangent(t)` to four or eight directions and pick the animation.
- [documented] `pathUpdate` calls `setPosition` with floats every frame. With `pixelArt: true` a translation-only follower is snapped at render time; see [pixel motion](pixel-motion-craft.md).
- [general] A rule-owned patrol is `s += speed * stepSeconds` in the sim, `wrap` or `yoyo` by hand, and the view calls `path.getPoint(s / length)` on the interpolated `s`. It saves, replays
  and pauses with the sim, which a follower cannot.

## Drawing and debugging

- [documented] `path.draw(graphics, 64)` strokes every curve; `Graphics.pathDetailThreshold` (4.0) skips vertices closer than the threshold, which speeds up complex curves drawn in
  small areas (`changelog/v4/4.0/CHANGELOG-v4.0.0.md`).
- [general] Draw paths only behind a debug flag and compare `getSpacedPoints(50)` markers against actual positions in a test; a path edit that forgets `updateArcLengths` shows up as
  markers bunching.

## Related

[Tweens](tweens-and-chains.md), [clocks](clocks-timers-and-delta.md), [pixel motion](pixel-motion-craft.md).
