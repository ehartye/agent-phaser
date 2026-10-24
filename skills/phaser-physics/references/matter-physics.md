# Matter physics in Phaser 4.2.1

Matter 0.20.0 is bundled (`src/physics/matter-js/lib/core/Matter.js`). Use it when realistic rigid bodies are the game; see [choosing physics](choosing-physics.md) first. Phaser's own guide is `node_modules/phaser/skills/physics-matter/SKILL.md`. Probe: `examples/web/phaser-probes/phaser-physics-matter.mjs` (`node phaser-physics-matter.mjs <host project>`).

## What differs from Phaser 3 advice

- [tested] `matter.set30Hz()`, `set60Hz()` and the `getDelta` option change nothing in 4.2.1. `World#update` runs a fixed-step runner (`runner.delta`, default 1000 / 60) and never calls `getDelta` (`src/physics/matter-js/World.js`, `MatterPhysics.js`). In two seconds of frames: default 119 updates, after `set30Hz()` 119, with `runner: { fps: 30 }` 59, with `{ fps: 120 }` 239. Set the rate in config: `matter: { runner: { fps: 30 } }`.
- [documented] Runner options are `fps` or `delta`, `frameDeltaSmoothing`, `frameDeltaSnapping` (rounds the frame delta to the nearest 1 Hz), `frameDeltaHistorySize`, `maxUpdates`, `maxFrameTime` (33.3 ms) and `enabled` (`typedefs/MatterRunnerConfig.js`).
- [tested] Long frames lose time instead of being caught up: with 100 ms frames the engine advanced about one update per frame (19 in two seconds). A frame delta above `max(1000 / 15, maxFrameTime)` is replaced by the last accepted one (`World.js#update`, `lib/core/Runner.js`), so a run of long frames makes physics run slow while game time does not.
- [documented] 4.0.0 added `Matter.Components.Transform#scale` and fixed a crash in `MatterTileBody` for flipped tiles (`changelog/v4/4.0/CHANGELOG-v4.0.0.md`).

## Stepping and determinism

- [tested] Frame rate does not change the update count: about 120 updates in two seconds at 30, 60 and 120 Hz and with 10 to 23 ms jittery frames.
- [tested] For exact control set `autoUpdate: false` and call `world.step(1000 / 60)` yourself, with one delta for the whole game. The delta changes the result: velocity is normalised to a 16.67 ms base step, so `setVelocity(6, 0)` moved 6 px in a 16.67 ms step and 12 px in a 33.3 ms step, and a 33.3 ms step gave a different final state for the same scene.
- [tested] The same scene gave the same result on a rerun even though body ids differed between runs (21 and 31 for the first body).
- [tested] A snapshot does not restore exactly. A fresh world given each body's position, previous position, angle and velocity ended up to 0.84 px from the uninterrupted run after 200 more steps.
- [general] The likely cause is contact and impulse state that the body fields do not hold. For exact resume use the sim or Arcade; a Matter save is only good for "close enough once it settles".
- [documented] `Body.setPosition(body, pos)` shifts `positionPrev` by the same amount, so velocity is unchanged (`lib/body/Body.js`); writing `sprite.x` is that call (`components/Transform.js`). Pass `updateVelocity = true` to turn the jump into velocity.

## Bodies, units and the game-object link

- [documented] Velocity is "per base step", not px per second, and forces are tiny: `setVelocity(3, -5)`, `applyForce({ x: 0.05, y: 0 })`, gravity scale 0.001 (Phaser's guide). To convert, `v_step = v_px_per_s / 60`.
- [documented] A Matter object's `x`, `y` and `rotation` are accessors onto the body (`components/Transform.js`), so there is no sync step. `scaleX` and `scaleY` setters rescale the body by undoing the old scale and applying the new one (the source comment reads "Reset Matter scale back to 1"), so scale once at creation, not every frame.
- [documented] `setRectangle`, `setCircle` and `setBody` replace the body and wipe mass, friction, filters and callbacks: reapply them (Phaser's guide). The body position is the centre of mass; `SetBody.js` moves the sprite origin to match.
- [documented] Filters: 32 categories from `world.nextCategory()`; `collisionFilter.group` overrides category and mask (same positive group always collides, same negative never); a sensor needs a matching filter to fire events (Phaser's guide).
- [general] Treat `collisionstart` as the one-shot and `collisionactive` as state. Handlers run inside the step, so queue body removals and apply them after `world.step`.

## Tilemaps

- [tested] `world.convertTilemapLayer(layer)` adds one static body per colliding tile (40 for a 40-tile floor), for a GPU layer too; set the layer's collision first. It reads `layer.getTilesWithin(..., { isColliding: true })` (`World.js`).
- [documented] A tile with Tiled collision shapes gets those shapes (rectangle, ellipse, polygon) and otherwise its rectangle; flipped tiles are scaled to match (`MatterTileBody.js`). Arcade ignores the shapes and always uses the full tile.
- [tested] Adjacent tile rectangles snag. Sliding at 6 px per step over 80 static 16 px rectangles, a frictionless box fell to about 0 speed in 7 of 8 start phases and a circle to about 2; one merged rectangle kept both at 6 in all 8 phases.
- [general] So merge runs of solid tiles into a few rectangles (or polygons from the map's object layer) before adding them. A large cave of solid tiles is otherwise thousands of static bodies.

## Tunnelling and cost

- [tested] Matter tunnels, a little sooner than Arcade: a 16 px body at 8 px per step stopped at an 8 px wall in all 25 start phases, at 10 px per step it passed in some, and at 40 px per step in some more. Arcade's safe step for the same shapes is 12 px.
- [general] So keep the Matter step clearly under half of body plus obstacle thickness (about 8 px here), or sweep the fast object yourself.
- [general] Cost grows with dynamic bodies and contacts: turn on `enableSleeping` for resting piles, keep solver iterations at defaults (6, 4, 2) until measured, and prefer Arcade for hundreds of simple movers. This page has no timing data.
