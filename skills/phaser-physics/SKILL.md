---
name: phaser-physics
description: Add collision and movement to a Phaser 4 game - Arcade or Matter bodies, colliders and overlaps, hitboxes, tilemap collision, one-way and moving platforms, curves, paths and PathFollower - or decide to keep collision in the headless sim. Use when choosing Arcade versus Matter versus your own collision, when bullets tunnel through walls, a hitbox sits wrong after a flip or scale, a dead bullet still hits, a placed tile does not block, a platform will not carry the player, or physics must save and replay exactly. Not for drawing or streaming tilemaps (phaser-worlds), tweens and animation (phaser-motion), the fixed-step loop and headless sim (engine-phaser), or browser proofs and profiling (phaser-verification).
---

# Phaser physics

Collision and movement in Phaser 4.2.1: whether engine physics belongs in the rules at all, how Arcade, Matter, tile collision and paths really behave, and how to test them. Phaser ships its own guides (`node_modules/phaser/skills/physics-arcade`, `physics-matter`, `curves-and-paths`); these references add the decisions, traps and numbers they leave out. Read the one that matches the work.

| You are about to | Read |
| --- | --- |
| Pick Arcade, Matter, your own collision or none; judge replay, save and Node-test cost | [choosing physics](references/choosing-physics.md) |
| Create bodies and colliders, size a hitbox, pool bullets, drive the step, stop fast things tunnelling | [Arcade bodies and colliders](references/arcade-bodies-and-colliders.md) |
| Use Matter bodies, tune its rate, snapshot it, convert tiles to Matter bodies | [Matter physics](references/matter-physics.md) |
| Make a tile layer solid, edit tiles at run time, collide across chunks, build one-way tiles | [tilemap collision](references/tilemap-collision.md) |
| Build a moving platform, a rider that stays on it, a patrol or a rail that must collide and replay | [paths and followers](references/paths-and-followers.md) |
| Test physics deterministically, snapshot it, chase tunnelling, jitter, sticking or ghost hits | [testing physics](references/testing-physics.md) |

## Rules that earned their place

- [general] **Decide whether collision is a rule before you pick an engine.** A game with a headless sim, saves or replays keeps collision in the sim (swept tests and grid queries, `scripts/assets/grid-sweep.mjs`) and lets engine bodies move only cosmetic things. Phaser as the whole game may use Arcade or Matter as its sim.
- [tested] **Take the step into your own hands.** `arcade: { customUpdate: true }` plus one `world.singleStep()` per sim tick gave exact, replayable steps; three `world.update()` calls then one `postUpdate()` kept one step, and a bare `world.step()` left `blocked.down` stale. Arcade restored exactly from positions and velocities; Matter drifted 0.84 px.
- [tested] **Limit the step, not the frame rate.** Arcade pushes a body out the side its centre ended on, so a step above half of body plus obstacle thickness tunnels (Matter began a little sooner); against tiles the limit is `tileBias` (16 px by default). Cap with `setMaxVelocity` (default 10,000 px/s), raise `tileBias`, or sweep the fast object yourself.
- [tested] **Disable bodies, do not hide them.** `killAndHide` leaves a live body that still fires overlaps; `disableBody(true, true)` removes it. `flipX` and negative scale do not move a hitbox, and a negative scale shifts a centred one.
- [tested] **Tile solidity has three traps.** A placed tile is solid only if its index is in `collideIndexes`, which `setCollisionByProperty` never fills. Collision uses the layer's own position, so a layer inside a container collides at the origin. A collider kept after its layer is destroyed throws every step. A GPU tile layer collides like a CPU one.
- [tested] **Matter changed in 4.2.1.** `set30Hz()` and `getDelta` do nothing: set `runner: { fps }`. Frames over about 67 ms lose time instead of catching up. Velocity is per 16.67 ms base step. One static body is added per colliding tile.
- [tested] **A `PathFollower` runs on `Date.now`, not on your stepped clock.** Drive gameplay motion from `path.getPoint(simTime / period)`, and give a platform moved by writing its position `body.setDirectControl(true)` or its rider is left behind. `getPoint(t > 1)` returns `null`, and an edited curve keeps a stale length until `updateArcLengths()`.
- [general] **Prove a limit from both sides.** Below it no failures over 25 start phases, above it at least one, and the fix back to none; then put the bug back and watch the probe fail.

## Run the probes

- [tested] Each probe boots a tiny Phaser 4.2.1 scene in Chromium, steps it by hand and asserts on body numbers: `node examples/web/phaser-probes/phaser-physics-arcade.mjs <host project>` (also `-tilemap`, `-matter`, `-paths`). The host project supplies `phaser` and `@playwright/test`. The sim helper's Node test is `node --test tests/phaser-physics-grid-sweep.test.mjs`.

## Not covered here

Drawing, chunk streaming and GPU layer bugs are [phaser-worlds](../phaser-worlds/SKILL.md). Tweens, timelines, animation, path arithmetic and followers as decoration are [phaser-motion](../phaser-motion/SKILL.md). The fixed-step loop and the headless sim are [engine-phaser](../engine-phaser/SKILL.md). Real-GPU proofs and profiling are [phaser-verification](../phaser-verification/SKILL.md). Physics in the other engines of this plugin is in [engine-r3f](../engine-r3f/SKILL.md) and [engine-babylon](../engine-babylon/SKILL.md).
