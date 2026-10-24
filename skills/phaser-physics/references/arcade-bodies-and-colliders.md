# Arcade bodies, colliders and the step (Phaser 4.2.1)

What Arcade does in 4.2.1 that its own guide (`node_modules/phaser/skills/physics-arcade/SKILL.md`) does not say: who owns the step, hitbox rules, pooling, and the speed limit. Probe: `examples/web/phaser-probes/phaser-physics-arcade.mjs` (`node phaser-physics-arcade.mjs <host project>`).

## Who calls the step

- [documented] The world steps from the scene `UPDATE` event with the scene's smoothed delta and writes positions back on `POST_UPDATE` (`src/physics/arcade/ArcadePhysics.js`, `World.js#update`, `#postUpdate`). `fixedStep: true` (default) accumulates delta into steps of `1 / fps`; `fixedStep: false` runs one variable step per frame and ignores `fps` and `timeScale`.
- [tested] Steps per second equal `fps` whatever the frame rate: 60 steps in a second of 60, 30 or 120 Hz frames, 30 with `timeScale = 2` (above 1 is slower), 120 after `setFPS(120)`. Velocity stays in px per second at any `fps`.
- [tested] Arcade has no catch-up cap of its own: one 2000 ms frame ran 119 steps.
- [documented] The bound is Phaser's delta handling, which replaces a delta above `1000 / minFps` (200 ms by default) with the oldest value in the ten-frame window, so a normal frame runs at most about 12 steps ([lifecycle gotcha 17](../../engine-phaser/references/phaser-4-scene-lifecycle-gotchas.md)).
- [tested] On 144 Hz frames with 60 Hz physics, 85 of 144 frames ran no step and 59 ran one. Arcade does not interpolate (`Body#postUpdate` writes the stepped position), so sprites move in uneven jumps.
- [general] A higher `fps` shrinks the jumps but does not remove them; for smooth motion on any display draw an interpolated copy of the body.
- [tested] To tie physics to your own fixed stepper set `customUpdate: true` and call `world.singleStep()` once per tick (several times for substeps). It does nothing while the world is paused.
- [tested] Do not call `world.update()` repeatedly for substeps: each call re-reads sprite positions, so three calls and one `postUpdate()` kept one step (x 101, not 103). `singleStep()` three times kept three. `world.step(1 / 60)` then one `postUpdate()` also works but skips the per-step reset of `touching` and `blocked`: `blocked.down` stayed true while a body rose.

```js
// physics: { default: 'arcade', arcade: { fps: 60, customUpdate: true } }
stepper.advance(delta, () => { applyInputToBodies(); for (let i = 0; i < 3; i++) this.physics.world.singleStep(); });
```

## Bodies: size, offset, scale, flip

- [tested] A body defaults to the frame size times the scale, centred on the origin (a 32 px sprite at scale 2 got 64 px). `setBodySize(w, h)` and `setOffset(x, y)` take source pixels and scale with the sprite: a 16 px body at scale 2 is 32 px wide and centred.
- [tested] `flipX` does not move the body, so an off-centre hitbox needs a new offset when the sprite turns: `setOffset(sourceW - offsetX - bodyW, offsetY)`. A negative `scaleX` shifts even a centred body by its width (192 became 208 for a 16 px body on a sprite at x 200); mirror with `flipX`.
- [tested] On an Arcade sprite `setSize()` resizes the body and leaves the sprite alone (deprecated, `src/physics/arcade/components/Size.js`); use `setBodySize()`.
- [documented] A static body does not follow its object: call `refreshBody()` after moving or scaling it (`src/physics/arcade/StaticBody.js`).
- [tested] A body on a child of a translated container sits at the child's world position and moves at its own speed (59 px in a second at 60 px/s). Under a container scaled 2 the child moved 118 px, and under one rotated 90 degrees it moved along y instead of x. `Body#updateBounds` reads the world transform but `#postUpdate` adds the movement to the local position. Put bodies only on children of containers that are translated, never scaled or rotated.
- [documented] `body.reset(x, y)` moves the object and zeroes velocity and flags; assigning `sprite.x` keeps velocity (`Body#reset`).

## Colliders, overlaps and pooling

- [documented] `collider` separates then calls back; `overlap` only reports; a `processCallback` returning false cancels both. Events (`collide`, `overlap`, `worldbounds`) fire only for bodies with `onCollide`, `onOverlap` or `onWorldBounds` set (`World.js#separate`).
- [tested] `group.killAndHide(sprite)` leaves the body live: the "dead" bullet still fired its overlap callback. `sprite.disableBody(true, true)` stops it; `group.get()` then `enableBody(true, x, y, true, true)` reuses it and resets velocity.
- [tested] For melee swings and blasts, ask instead of spawning a body: `physics.overlapRect(x, y, w, h, includeDynamic = true, includeStatic = false)` and `overlapCirc(x, y, r)` return the bodies in an area and created none (a static wall was skipped until `includeStatic` was true).
- [documented] A `Collider` holds its objects until `collider.destroy()` (`src/physics/arcade/Collider.js`), and a disabled body stays in `world.bodies`, which is loaded into the tree each step (`World.js#update`). [general] Size pools to what you need.
- [documented] Defaults that bite: world bounds are the game size at creation, not the map size, so call `setBounds` (`World.js` constructor); gravity and acceleration are px per second squared; drag only applies while acceleration is 0; categories come from `physics.nextCategory()`, 32 at most.
- [documented] The world is destroyed on scene shutdown and rebuilt on start, so a restart needs fresh bodies and colliders (`ArcadePhysics#shutdown`).

## Movers, pushing and riders

- [documented] An `immovable` body never moves in a collision; `pushable = false` reflects velocity back but can still be separated; `slideFactor` 0 stops a pushed body when the push ends (`Body.js`). An immovable body in motion gives a rider `friction` of its motion, default (1, 0): horizontal only (`Body#friction`).
- [tested] A static body with `checkCollision.down`, `left` and `right` set false is a one-way platform: a body rising from below passed through, and one falling from above landed on top.
- [documented] `physics.moveTo` and `moveToObject` set velocity once: they do not follow a moving target, stop on arrival, or respect acceleration, `maxVelocity` or drag (`ArcadePhysics.js#moveTo`). Stop on arrival in your update.
- [tested] A platform moved by writing its `x` does not carry a rider; with `body.setDirectControl(true)` it does. See [paths and followers](paths-and-followers.md).

## Speed and tunnelling

- [documented] Separation pushes the body to the side its centre ended on (`body1OnLeft` in `src/physics/arcade/ProcessX.js`) and ignores an overlap larger than the two bodies' combined movement this step plus `overlapBias`, default 4 (`GetOverlapX.js`).
- [tested] So a step up to half of body plus obstacle thickness is safe. A 16 px body and an 8 px wall give 12 px, 720 px/s at 60 Hz: 600 and 700 px/s never passed over 25 start phases, 1200 px/s passed 9 times, 3000 px/s all 25. `setMaxVelocity(700, 700)` made a 3000 px/s request safe.
- [tested] The default `maxVelocity` is 10,000 px/s per axis: gravity 2000 reached 4000 px/s, a 66 px step. A body spawned deep inside a static body is not ejected.
- [general] Derive the cap from the thinnest obstacle: `maxSpeed = fps * (bodyThickness + obstacleThickness) / 2`. If that is too slow for the game, raise `fps`, or hand that object to the sim's swept test (`scripts/assets/grid-sweep.mjs`).

## Pause, debug and cost

- [documented] `world.pause()` stops stepping and colliders, and `arcade: { isPaused: true }` starts paused. Debug drawing (`arcade: { debug: true }` or `world.createDebugGraphic()`) clears and redraws a Graphics every frame (`World.js#postUpdate`), so remove it from release builds.
- [documented] The dynamic tree is rebuilt each step; Phaser's guide suggests `useTree: false` only past thousands of dynamic bodies. Measure your own count before changing it; this page has no timing data.
- [general] Verify a hitbox by reading `body.x`, `body.y`, `body.width` after one step, not by eye: see [testing physics](testing-physics.md). Moving platforms and followers: [paths and followers](paths-and-followers.md). Tiles: [tilemap collision](tilemap-collision.md).
