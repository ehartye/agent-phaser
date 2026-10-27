# Scene transitions (Phaser 4.2.1)

`this.scene.transition(config)`: how it starts, what runs and accepts input while it plays, and what the outgoing scene becomes. The shutdown-listener rule for transitions is in [events and data](../../engine-phaser/references/events-and-data.md); fades and wipes are in [pixel motion craft](pixel-motion-craft.md). Every check id below is in `phaser-motion-scenes.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md).

## The call

- [documented] `this.scene.transition({ target, duration, data, sleep, remove, allowInput, moveAbove, moveBelow, onUpdate, onStart })` (`src/scene/ScenePlugin.js`). `duration` defaults to 1000 ms. It returns `false` and does nothing when the target does not exist, is already active or transitioning, is the calling scene, or the caller is already transitioning. `onUpdate(progress)` gets 0 to 1; `onStart(from, to, duration)` runs once.
- [tested] Order with a not-yet-started target and `data: { from: 'A', n: 7 }`: the target's `init(data)` and `create`, then its `transitionstart(fromScene, duration)`, the caller's `transitionout(targetScene, duration)`, and at the end the target's `transitioncomplete` and the caller's `shutdown` (`scene-transition-events-and-data`). Put the entrance effect in the target's `transitionstart` handler and the exit effect in the caller's `transitionout` handler.
- [tested] The duration is scene time: 300 ms of 16.67 ms hand-stepped frames took exactly 18 frames, `onUpdate` ran once a frame and ended at exactly 1, so a transition is deterministic under `game.step`. A tween or fade you start for the effect is not (tweens read the wall clock, [clocks and delta](clocks-timers-and-delta.md)): drive the visual from `onUpdate`'s progress when the test must be exact.

## What runs during it

- [tested] Both scenes update every frame for the whole duration (10 of 10 frames each) and both report `sys.isTransitioning()`; they are both live, so the outgoing scene's timers, physics and enemies keep running until it shuts down. Pause or freeze what must not move.
- [tested] Input is off for both scenes by default (`sys.input.enabled` is false and a real click reached neither). With `allowInput: true` it is on for both and the scene highest in the list took the click (`scene-transition-input`). A control click on a running scene registered, so the zero is the transition and not the test.

## What the outgoing scene becomes

| Config | Outgoing scene afterwards | Use when |
| --- | --- | --- |
| default | shut down, still registered: `scene.start('A')` runs it again | a level or menu rebuilt on entry |
| `sleep: true` | sleeping, state kept, resumes with `wake` | a hub you come back to |
| `remove: true` | removed from the scene manager | a one-off intro or cutscene |

- [tested] The three outcomes above are statuses 8 (shutdown), 7 (sleeping) and gone from `game.scene.scenes`, and the target ends running (status 5) in all three (`scene-transition-end-states`).
- [tested] A sleeping target is woken, not restarted: it gets `wake` and `transitionwake(fromScene, duration)`, and its `init` and `create` do not run again, so `data` reaches its wake handler and not `init` (`scene-transition-wakes-a-sleeping-target`).
- [tested] `moveAbove: true` moves the target above the outgoing scene in the list; with the default a target below the outgoing scene is drawn under it for the whole transition (`scene-transition-move-above`).

## Traps

- [documented] Do not start the target yourself with `scene.start` and then call `transition`: an active target is not valid (`checkValidTransition` in `ScenePlugin.js`) and the call returns `false`.
- [general] The transition does not draw anything. A black cut is the default look; a fade, wipe or pan is yours to build in the two handlers (a camera `fadeOut` on the caller and `fadeIn` on the target, or a Wipe filter, [filters](../../phaser-rendering/references/filters.md)), with the duration passed to both.
- [general] Listeners added to `this.events` in `create` accumulate across restarts, because shutdown removes only the transition listeners; register with `once` or remove them in your own `shutdown` handler.
