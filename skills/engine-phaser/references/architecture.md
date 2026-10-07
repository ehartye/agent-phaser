# Phaser architecture that scales

This is the structure Fallow Valley uses. It is a pattern, not a framework: copy the shape, not the code. The whole rule set is
indexed in [phaser reference](phaser-reference.md); boot, scenes, plugins and the loop are in [scenes, loop and plugins](scenes-loop-and-plugins.md).

## The one idea

> **The world is `f(seed) + delta`. Phaser is a view of it.**

- A headless **sim** (plain TypeScript, no Phaser, no DOM, no `Math.random`, no `Date`) owns every rule and all state.
- The Phaser **game layer** renders the sim and turns input into commands. It never mutates the sim.
- A save is the seed plus a *delta*: only what the player changed. Generated terrain is recomputed on load.

Enforce the boundary with a test (scan `src/sim` and `src/content` for imports of `phaser`, `document`, `window`,
`Math.random`, `Date.now`). Conventions erode; a failing test does not.

## Layers

```
content  ->  (nothing)           typed data: items, crops, recipes, biomes, creatures, weather tables
sim      ->  content             rules, world generation, farming, needs, AI, saves
game     ->  sim, content, phaser   scenes, plugins, views, input, audio, UI
```

Content is data only, so a designer can add a crop without touching a rule.

## Data flow

```
input device -> InputController (named actions) -> Command -> Sim.dispatch(cmd)
                                                              | fixed step, 20 Hz
                                                              v
                       SimEvent (one closed union) -> views, FX, audio, HUD
```

Commands go in, events come out. Make `SimEvent` a single closed discriminated union and give the audio director a
compile-time check that every event has a decision: adding an event then fails the build everywhere it matters.

## Determinism primitives

- A seeded generator (sfc32) with `fork(label, x, y)` for independent sub-streams, so generation order never matters.
- Hash-based value noise for terrain fields. Weather and daylight are *pure functions* of (seed, time, biome): nothing to
  save and nothing to desync.
- Fixed timestep: a `FixedStepper` accumulator turns Phaser's variable frame delta into 20 Hz sim steps and returns an
  interpolation fraction (alpha) so views glide between the previous and current state at any refresh rate. Cap the
  catch-up steps so a background tab cannot spiral.

## Phaser patterns worth showing

| Feature | Use |
| --- | --- |
| Global plugin (`BasePlugin`, mapped as `scene.simHost`) | owns the Sim and storage so scenes can restart freely; auto-unsubscribes scene listeners on shutdown |
| Scenes launched in parallel | `World` plus `Ui` (HUD) plus modal scenes; `launch`, not `start` |
| Registry | settings and cross-scene read models; never game state |
| Aseprite loader | `load.aseprite` then `anims.createFromAseprite` for agent-sprites sheets |
| Tilemap layers, pooled | one pooled view per visible chunk, rebound as the camera moves, so scrolling allocates nothing |
| Cameras | integer source-pixel footprint (art scale × camera zoom), visible chunks from `camera.worldView`; see [pixel scaling](pixel-perfect-and-ui.md) |
| Particle emitters | one reused emitter per effect; `explode` for bursts; weather is one emitter reconfigured per weather |
| Tweens and `time` events | feedback and timers in the view; `setTimeout` only outside the world (delayed audio cues, debug polling) |

## Sim design choices that paid off

- **Tiles are struct-of-arrays in typed arrays per chunk** (`Uint8Array` layers). A chunk records which tiles the player
  edited; that set is the save delta.
- **Simulate only active things.** Growth iterates a per-chunk set of tilled or planted tiles; out-of-range chunks are
  caught up in hour-sized steps when revisited, with a cap so a long absence cannot stall a frame.
- **Collision belongs to the sim.** Movement and creature AI use the sim's tile grid, not Arcade physics. Say so in the
  docs; the physics engine is simply not part of a deterministic rules layer.
- **Levels are worlds.** An underground level is another `World` with its own generator; entities carry a `level`; the
  view releases every bound chunk on a level change.
- **Pens fall out of collision.** Animals respect solid tiles, so player-built fences contain them with no pen system.

## Testing shape

Unit tests (Node, milliseconds) for rules, generation, saves and layer boundaries. Browser tests on a real GPU for
rendering, streaming and pooling. See [verifying on a real GPU](verifying-on-a-gpu.md).
