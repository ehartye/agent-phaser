# Testing physics: stepping, snapshots and a symptom checklist

How to test collision and movement so a failure names its cause. Generic frame stepping and pixel reads are in [verifying loop and waiting](../../phaser-verification/references/verifying-loop-and-waiting.md) and [verifying on a GPU](../../phaser-verification/references/verifying-on-a-gpu.md); this page covers what physics adds. Probes are in `examples/web/phaser-probes/` (`phaser-physics-arcade.mjs`, `-tilemap.mjs`, `-matter.mjs`, `-paths.mjs`, each run as `node <file> <host project>`); the Node test is `tests/phaser-physics-grid-sweep.test.mjs`.

## Drive time by hand

- [tested] Put the game to sleep with `game.loop.sleep()` so `requestAnimationFrame` does not also step it, then step yourself: `game.step(time, delta)` with a renderer, `game.headlessStep(time, delta)` under `type: Phaser.HEADLESS`, where `game.step` throws because `renderer` is null (`src/core/Game.js`). Neither smooths the delta, so a test controls the clock exactly.
- [tested] For physics alone use `arcade: { customUpdate: true }` and call `world.singleStep()`: N calls were exactly N steps, and frames moved nothing. Under the automatic step, 60 frames of 16.67 ms gave 60 steps, but 33 ms frames gave two steps a frame, and a float remainder can carry one step into the next frame (a 500 ms frame ran 29 of 30). Assert on totals over a second, not on single frames.
- [tested] Tweens and path followers read `Date.now`, so stepped frames do not move them. Make `Date.now` return a counter you advance with each step, or test the sim-time evaluation instead ([paths and followers](paths-and-followers.md)).
- [general] Use a Phaser game only for what needs it. Rules, swept tests and snapshots belong in Node tests; the browser probe checks that the engine behaves the way the rules assume.

## Pure helpers in Node

- [tested] `skills/phaser-physics/scripts/assets/grid-sweep.mjs` exports `moveAndCollide`, `sweepAabb` and `raycastGrid` with no Phaser or DOM import. `node --test tests/phaser-physics-grid-sweep.test.mjs` checks flush stops, wall slides, floor contact every step, no ejection from an embedded start, ray hits, and a JSON snapshot that resumes identically.
- [tested] Randomise the start phase. The seeded tunnelling test lets 376 of 400 shots through when only the end point is tested, and none through the sweep. A fixed phase can hide the bug entirely, as it does for the same test in the other engines of this plugin.
- [general] State everything a restore needs as plain numbers (position, velocity, grounded flag, timers, RNG words) so a save is a JSON round trip.

### Bind a consumer to the actual grid contract

- [documented] [grid-sweep.mjs](../scripts/assets/grid-sweep.mjs) takes a top-left box `{ x, y, w, h }`, displacement `(dx, dy)`
  in world units, and `{ tile, isSolid(cx, cy) }` with integer cell coordinates. The box uses half-open extents. `moveAndCollide`
  sweeps X first, then Y at the new X, and returns coordinates and hit signs; it does not mutate a body or own velocity, time,
  gravity, grounded state, terrain, saves or rendering. An embedded start is not ejected. `sweepAabb` instead tests one static
  box; `raycastGrid` tests a segment and reports a solid starting cell at `t: 0`. These are distinct queries.
- [general] Before a pilot, declare finite coordinates/displacements, positive box dimensions and tile size, a stable solid-cell
  query, and one consistent unit system. Convert velocity to per-step displacement and centre/feet anchors to top-left boxes
  explicitly. Tile-unit positions, non-square cells, slopes, moving obstacles and actor-specific door/terrain rules require their
  own mapping or a different algorithm; do not silently approximate them with a uniform static grid. The helper does not validate
  every malformed input or provide depenetration. Keep the game's intended embedded-start and boundary policies explicit.
- [general] Authenticate the consumer revision, helper bytes/import and actual movement call before claiming adoption. Keep
  alternative collision code classified separately unless copy provenance is established; similar X-then-Y arithmetic is not
  provenance. Record search roots/exclusions and missing access. If the inspected feature has no uniform tile collision, mark
  this integration not applicable to that feature instead of treating an unused helper as a successful migration.
- [general] At the consumer boundary, compare the former and proposed units, shape, sweep order, solid-cell rules, embedded
  starts and hit-response policy. A later pilot must verify those mappings and restore the world/query state, clock, RNG and
  actor state it actually uses. The four-number snapshot test above covers its fixed fixture only; a green producer test or a
  retained save file proves neither consumer restoration nor native integration. Preserve the end-position tunnelling negative
  when running `node --test tests/phaser-physics-grid-sweep.test.mjs`.

## Browser probes

- [general] Boot the smallest scene that shows the case, build the bodies, step N times, read `body.x`, `body.y`, `blocked`, `touching`, and return plain data. Never return Phaser objects across `page.evaluate`. Assert in Node.
- [tested] Prove a limit from both sides: below it zero failures over 25 start phases, above it at least one, and the fix (`setMaxVelocity`, `tileBias`) back to zero. The Arcade probe does this at 600, 700, 1200 and 3000 px/s; a test that only shows the passing side proves nothing.
- [general] Use the default `HEADLESS` type unless a GPU tile layer or filter is involved; software WebGL is enough for collision logic and says nothing about speed. `HEADLESS` installs none of the `plugins.global` entries ([deterministic test driving](../../phaser-verification/references/deterministic-test-driving.md)).
- [general] Prove a regression test by mutation: put the bug back (`tileBias` to 16, `killAndHide` for `disableBody`), watch the probe fail, restore.

## Snapshot and restore

- [tested] Arcade restores exactly. Saving each body's position and velocity, wrecking the world, then calling `body.reset(x + halfWidth, y + halfHeight)` and `setVelocity` continued identically to an uninterrupted 600-step run with three bouncing bodies, walls, bounds and body-versus-body colliders.
- [tested] Matter does not: a fresh world restored from positions, previous positions, angles and velocities differed by up to 0.84 px after 200 steps.
- [general] Save the world's accumulator too if you step with `update()`; with `singleStep()` there is none to save. Store the sim's own clock and RNG next to the body state ([architecture](../../engine-phaser/references/architecture.md)).

## Symptom checklist

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Fast things pass through thin walls | step above half of body plus wall, or above `tileBias` | speed / fps against the limit; scan start phases |
| Hitbox is off after the sprite turns | `flipX` and negative scale do not move the body | print `body.x` against `sprite.x` after the flip |
| Dead bullets still score | `killAndHide` leaves the body live | `body.enable` |
| Platform does not carry its rider | position written without `setDirectControl(true)` | `body.directControl` |
| Player slows or stops at floor seams | `collideTiles`, or adjacent Matter tile rectangles | slide along the floor at real speed from several start phases |
| Placed wall tiles do not block | index not in `layer.layer.collideIndexes` | read the array |
| Chunk collision sits at the origin | layer inside a container | compare the stop `x` with `layer.x` |
| `reading 'tileWidth'` every frame | collider kept after its layer was destroyed | destroy colliders with their layer |
| Sprite judders on a 120 or 144 Hz screen | Arcade does not interpolate | steps per frame over a second |
| Matter runs slow in a stalled tab | long frames lose time instead of catching up | count `beforeupdate` per frame |

- [tested] Every row has a measurement behind it in the four probes above. Reproduce a symptom with the check column before changing code, and rerun the probe after the fix so the number moves.
