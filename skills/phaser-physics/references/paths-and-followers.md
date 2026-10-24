# Moving platforms, patrols and followers in Phaser 4.2.1

The physics side of paths: which driver to use for something that must collide, how to make a moving platform carry a rider, and how to steer a patrol that replays. Path arithmetic, spacing, followers as decoration and tween clocks are in [phaser-motion](../../phaser-motion/SKILL.md); Phaser's own guide is `node_modules/phaser/skills/curves-and-paths/SKILL.md`. Probe: `examples/web/phaser-probes/phaser-physics-paths.mjs` (`node phaser-physics-paths.mjs <host project>`, no GPU).

## Pick the driver

| Driver | Clock | Replayable | Carries a rider | Use when |
| --- | --- | --- | --- | --- |
| `PathFollower` or a tween | wall clock (`Date.now`) | no | only with `setDirectControl(true)` | cosmetic motion: props, background creatures, menus |
| `path.getPoint(simTime / period)` set each tick | your sim clock | yes | with `setDirectControl(true)` | gameplay platforms and rails |
| Velocity toward the next waypoint | the physics step | yes, with a hand-driven step | yes, through `friction` | enemies that must collide as they move |
| Your own waypoint walker in the sim | the sim clock | yes | the sim decides | headless rules ([architecture](../../engine-phaser/references/architecture.md)) |

- [tested] A follower advances on `Date.now`, not on stepped frames: 60 stepped frames moved it 0 px, and with `Date.now` following the stepped clock it reached progress 0.48 after 30 frames. It also draws one frame behind its tween, because its `preUpdate` reads the value the tween set in the previous `UPDATE` (x 186.67 against a tween point of 193.33). `TweenManager#getDelta` reads `Date.now` (`src/tweens/TweenManager.js`).
- [documented] Phaser has no pathfinding or navigation mesh: no such module exists under `src/`. `Path` plays a route you supply. Compute routes (A* on the sim's grid) in the rules and use a `Path` only to draw or to sample the result.

## Path facts that bodies depend on

- [tested] `Path.getPoint(t)` is uniform in arc length across segments (25, 50 and 75 percent of a 300 px plus 100 px path land at 100, 200 and 300 px), returns `null` for `t` above 1 and for an empty path, and returns `Vector2` (`Phaser.Geom.Point` is gone in 4.x). Guard every read: `path.getPoint(Math.min(t, 1), tmp)`.
- [tested] Lengths are cached: editing a curve in place left `path.getLength()` at 314.11 instead of 628.22 until `curve.updateArcLengths()` then `path.updateArcLengths()` ran. A platform on an edited path drifts off its speed until you do.
- [tested] A path with a `moveTo` gap had 3 curves and length 200 for two 100 px lines: the gap adds no length, so a point moving along it jumps from one end to the next start.

## Moving platforms and riders

- [tested] A platform moved by writing its position each frame (a follower or a tween) did not carry a rider: the rider stayed at x 200 while the platform slid away. A velocity-driven platform carried it, and so did a follower platform with `body.setDirectControl(true)`, which derives the body's velocity from its movement. `Body.js` documents this for "a Tween, or ... a Path".
- [documented] Make the platform `setImmovable(true).setAllowGravity(false)`; its `friction` default (1, 0) hands the rider its horizontal movement (`Body#friction`).
- [general] Gameplay platforms should follow the sim clock, set inside the fixed step before the physics step so the body sees this tick's movement:

```js
const frac = (simMs % periodMs) / periodMs;
const u = 1 - Math.abs(1 - 2 * frac);                // ping-pong; use frac for a loop
path.getPoint(u, tmp);
platform.setPosition(tmp.x, tmp.y);                  // body: setDirectControl(true), immovable, no gravity
```

- [general] Vertical platforms need their own test: a rider squeezed between a rising platform and a ceiling has no rule in Arcade.

## Patrols and steering

- [tested] `physics.moveTo(body, x, y, speed)` sets velocity once and never stops: a body sent to x 300 at 120 px/s was at x 460 after three seconds, still moving (`ArcadePhysics.js#moveTo` says it does not track a target or stop on arrival, and ignores acceleration, `maxVelocity` and drag).
- [tested] Steering instead sets velocity toward the next waypoint each tick and advances the index within one step length of it. Three waypoints were reached at steps 99, 177 and 275, and a second run gave the identical result with `singleStep()` driving the world.
- [general] Keep the waypoint index and the route in the sim, so a save stores two numbers and a replay needs no Phaser. Choose the arrival radius as at least `speed / fps`, or a fast patrol circles its target.

## Clocks and tests

- [documented] Tweens and followers run on `Date.now`, physics on the scene delta (`World#update`), and the sim on its own stepper.
- [general] In a stalled tab the three clocks diverge by their own clamps, so anything that must match the rules uses sim time.
- [tested] In a frame-stepped test a follower never moves unless `Date.now` follows the stepped clock: set `Date.now = () => fake` and advance `fake` with each step, use Playwright's `page.clock` ([phaser-motion](../../phaser-motion/SKILL.md) covers it), or use the sim-time recipe above and assert on `path.getPoint(t)` directly.
