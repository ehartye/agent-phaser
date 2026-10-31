# Choosing physics for a Phaser 4 game

Decide whether engine physics belongs in the rules, and which one. Phaser 4.2.1 ships Arcade (boxes and circles, fast, simple) and Matter 0.20 (rigid polygons, constraints, stacking). The third choice is collision you write inside the headless sim. Probes: `examples/web/phaser-probes/phaser-physics-arcade.mjs` and `phaser-physics-matter.mjs`; sim helpers: `skills/phaser-physics/scripts/assets/grid-sweep.mjs` with `node --test tests/phaser-physics-grid-sweep.test.mjs`.

## Decide first: is collision a rule?

- [general] If the game keeps a headless sim (saves, replay, Node tests: see [architecture](../../engine-phaser/references/architecture.md)), collision is a rule. The sim cannot import Phaser, so engine bodies cannot live in it. Write swept tests and grid queries in the sim and let Phaser draw the result.
- [general] If Phaser itself is the game (a prototype, a jam game, a small arcade game with no saves or replays), Arcade or Matter is the sim. Say so in the project docs, and test it in a browser.
- [general] The safest mix is a hybrid: the sim owns every hit that changes a rule, and engine physics moves only cosmetic things (debris, ragdolls, shells) whose result is never saved.

## The options

| Question | A. Sim collision | B. Arcade | C. Matter |
| --- | --- | --- | --- |
| Shapes | what you write: boxes, cells, segments | axis-aligned boxes and circles; tiles always as boxes | convex polygons, circles, compounds, constraints |
| Same inputs, same result | yes, plain arithmetic | yes, when you drive the step | yes, with a fixed delta and a hand-driven step |
| Exact snapshot and restore | yes, state is plain numbers | yes, positions and velocities | no, contact state is hidden |
| Runs in Node tests | yes | no, needs the browser | no, needs the browser |
| Tile maps | grid lookups you own | layer colliders, with a speed limit | one static body per tile; seams snag bodies |
| Fast small things | sweep the supported shape and static grid | tunnels above a computable step | tunnels the same way |

- [tested] Arcade replays exactly: the same inputs gave the same bodies on a rerun, and positions plus velocities saved as plain numbers restored to identical results. Matter gave the same result on a rerun even with different body ids, but a fresh world restored from positions and previous positions drifted 0.84 px after 200 steps. Run `node phaser-physics-arcade.mjs <host>` and `node phaser-physics-matter.mjs <host>` from `examples/web/phaser-probes`.
- [tested] Matter tunnels too, a little sooner: a 16 px body at 8 px per step stopped at an 8 px wall in all 25 start phases, and at 10 px per step passed it in some (`phaser-physics-matter.mjs`).
- [tested] In the sim helper's seeded run of 400 shots at 900 to 20,900 px/s with random start phases, testing only the end point let 376 through a one-tile wall and `moveAndCollide` let none through (`node --test tests/phaser-physics-grid-sweep.test.mjs`). This is the declared box/static-grid fixture, not certification of arbitrary consumer collision.
- [documented] Arcade tile collision treats every body as a rectangle, even a circle body (`src/physics/arcade/tilemap/TileIntersectsBody.js`), and `src/physics/arcade` has no slope handling.
- [documented] Arcade resolves overlaps by projection and says so: it "lacks stability when multiple objects are in close proximity or resting upon each other" (`src/physics/arcade/World.js`, doc comment of `collide`).
- [documented] Matter 0.20.0 is bundled (`src/physics/matter-js/lib/core/Matter.js`).

## What each option costs

- [general] **A. Sim collision.** Time: a day for boxes and tiles, longer for slopes or rotation; you need the helper and its tests. Risk: low for what you test, you own every edge case (corner slide, embedded start). Complexity: the view must interpolate sim positions, but nothing fights an engine. Best practice: matches the headless-sim architecture and the swept-test advice for the other engines in this plugin. Maintainability: highest, one pure module with Node tests, no dependency on Phaser's internals.
- [general] **B. Arcade.** Time: minutes for a platformer or shooter. Risk: tunnelling past a step limit, stale hitboxes after scale or flip, pooled bodies still colliding, all listed in [Arcade bodies](arcade-bodies-and-colliders.md). Complexity: Phaser owns positions, so it must not also be a pure sim. Best practice: fine as the sim of a small game, wrong inside a replayable one. Maintainability: moderate; the traps are version-specific.
- [general] **C. Matter.** Time: hours, more for tuning stacks and tile edges. Risk: heavier per step, time is dropped on long frames, snapshots drift, forces and velocities are in odd units. Complexity: highest; two position systems (body and sprite), compound bodies, constraints. Best practice: right for physical toys and puzzles where realism is the game. Maintainability: low unless the physics is the product.
- [general] **D. Overlap tests only.** Time: minutes. Risk: none for hit tests; it cannot stop anything. Complexity: lowest. Best practice: correct when nothing needs resolving (pickups, zones, hit checks using `Phaser.Geom.Intersects` in the view). Maintainability: high.

## When engine physics is the wrong tool

- [general] Grid and turn-based games (roguelikes, tile puzzles, card games): positions are cells, collision is a lookup. Engine bodies add a second source of truth.
- [general] Lockstep multiplayer, replays and save games that must resume exactly: use A, or Arcade with a hand-driven step and exact snapshots. Not Matter.
- [general] Many small fast projectiles: consider a swept test for each shot against supported shapes. Measure cost in the game and check its actual displacement, geometry and collision policy; a helper's pure test does not establish native integration or a performance saving.
- [general] Choose a helper only after mapping units, anchors, solid-cell rules, X-then-Y resolution, embedded starts and restored
  state to its contract ([consumer integration checks](testing-physics.md#bind-a-consumer-to-the-actual-grid-contract)).
  A same-named export or unused import is not adoption. Keep game-specific collision and focus policies owned by the game;
  an authenticated source inventory can recommend a later pilot without implying that migration has already happened.
- [general] Code that writes `x` and `y` or zeroes velocity every frame to defeat the engine: the engine is not doing the job, so drop it for that object.

## Phaser 3 advice that no longer holds

- [tested] `matter.set30Hz()` and the `getDelta` option do nothing in 4.2.1; set `runner: { fps: 30 }` instead. See [Matter](matter-physics.md).
- [documented] Curve and path methods return `Vector2`, and `Phaser.Geom.Point` is gone (`changelog/v4/4.0/MIGRATION-GUIDE.md`, "Geometry: Point Replaced by Vector2"). Code that builds `Point` objects for paths fails.
- [documented] `sprite.setSize()` on an Arcade sprite is deprecated in favour of `setBodySize()` (`src/physics/arcade/components/Size.js`).
