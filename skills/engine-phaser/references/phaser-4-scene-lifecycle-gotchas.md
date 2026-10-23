# Phaser 4.2.1 scene lifecycle and input gotchas

Restarting scenes, what survives stop and start, the smoothed delta, interactive objects and reused Scene objects. Numbers match the index in [phaser-4-gotchas.md](phaser-4-gotchas.md).

## 11. Restarting scenes: a loading scene ignores `start`, and the sim must change in `init`, not before

Found building a title screen that plays the real world scene behind its menu, then starts a game over it (Phaser 4.2.1).

* [general] `scene.start('world')` on a scene that is **running, paused or sleeping** shuts it down and restarts it (`init`, `preload`, `create`
  again). On a scene that is **starting, loading or creating** (statuses START to CREATING) `SceneManager.start` returns without doing
  anything, so the data you passed never arrives. Gate a start on `scene.isActive(key)` and queue it for the first frame it is true.
* [general] Do not "fix" that with `stop` then `start`: stopping a scene mid-load leaves its queued files in the loader, and the second load
  logs `Texture key already in use` for every atlas. Load the scene's assets in an earlier scene instead (one function that queues
  them, called from the preload scene; the loader skips keys already cached, so the scene's own `preload` calling it again is free).
* [general] If a global object holds the game state (a global plugin), do **not** swap it in the scene that decides to start. The running
  scene keeps drawing for the rest of that frame and the next, one world's views with the other world's entities. Pass a `boot`
  callback in the start data and call it first thing in the restarted scene's `init`.
* [general] A modal or panel that rebuilds its own window (a changed row, a new page) must re-centre it: only the stack that opened it knew
  where it belonged, so the rebuilt window appeared at (0, 0). Put placement in the base class `layout`.

## 14. Scene lifecycle: what survives stop/start

- [general] `Systems.shutdown()` removes only the TRANSITION_* listeners and emits SHUTDOWN. A scene's own `events` emitter keeps every other
  listener (a `scene.events.on(WAKE)` in `create()` stacks one per visit); game-wide emitters (`game.events`, `scale`, `registry.events`),
  the global texture manager and the DOM obviously outlive the scene. The scene's input/keyboard plugins and display list do clean
  up. Also: the Scene *object* is reused, so a `WeakMap<Scene, Pool>` hands out images that were destroyed with the display list,
  field initialisers run once per Scene object (reset accumulators in `init()`), and canvas textures you made are yours to remove.
  Remove everything in one SHUTDOWN handler. Guard it with a browser spec that restarts the scene ten times and requires listener
  counts per event name (`emitter.eventNames()` / `listenerCount`), texture count and display-object count not to grow, plus a static
  test that a file subscribing to a long-lived emitter also unsubscribes. Prove it red by mutation.

## How these were found (do it this way)

1. [general] Build the smallest standalone version in the live scene (`scene.make.tilemap({ data })` plus a layer inside a
   container) and compare with the real pipeline.
2. [general] Read a screenshot pixel at a tile whose data you know, then toggle the other layers one at a time and read again.
3. [general] Print the layer data and compare with the pixel: that separates a data bug from a render bug.
4. [general] Read Phaser's source for the render node (`src/renderer/webgl/renderNodes/submitter/`) once you have a suspect.
5. [general] Re-introduce the bug and confirm the regression test fails.

## 17. The `delta` your scene receives is smoothed

- [general] `TimeStep.step` hands scenes `smoothDelta(delta)` when `smoothStep` is true (the default): the mean of the last ten deltas, and any delta above
  `1000 / minFps` replaced by the last sane value (`src/core/TimeStep.js#L570`). Accumulators are fine with that; code that wants the real frame time
  should read `game.loop.rawDelta`. `game.step(time, delta)` bypasses smoothing, so a hand-driven test loop and the live loop differ slightly: test the
  pure stepper with raw numbers and trust the game loop for the rest.

## 19. Never destroy and recreate interactive objects in response to input

- [general] A "dirty flag, rebuild everything once per tick" UI is lossy for the mouse in two ways. (1) Phaser's click is down plus up on the same object, so a
  rebuild between them hands the release to a new object that never saw the press. (2) Phaser adds a new interactive object to the input list in the
  scene's PRE_UPDATE, after that frame's queued pointer events are processed, so the frame after a rebuild is deaf: `pointerdown` fires on the scene but
  no `gameobjectdown`. Hover is the usual trigger (it sets the dirty flag just before the click), and it costs about 1 click in 20 with Playwright's
  instant move, down, up under load. Build zones and buttons once per layout and update them in place (`setLabel`, `setFocused`, `setVisible`); rebuild only
  the passive art on state changes. Test it deterministically: `game.loop.sleep()`, `mouse.move`, `mouse.down`, `game.loop.wake()`, wait a few frames,
  `mouse.up`; assert the scene's `input._list` is unchanged after state changes. The working shape is a panel with `build()` once and `refresh()` in place.

## 22. A Scene object is reused, so state keyed to it survives with destroyed display objects

- [general] Besides listeners (gotcha 14): a field initialiser or a `WeakMap<Scene, Pool>` runs once per Scene object, so after a restart the pool still holds images that were destroyed with the display list (invisible shadows). Reset such state in `init`/`create` or on `SHUTDOWN`, and write a spec that restarts and then uses it.
