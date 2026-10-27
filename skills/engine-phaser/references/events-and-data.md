# Events, data and what survives a scene (Phaser 4.2.1)

Who owns each emitter, how to clean up, where state may live, how data crosses scenes and where saves stop. This extends gotcha 14 ([scene lifecycle](phaser-4-scene-lifecycle-gotchas.md)) with a table read from source and checks from the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs). Phaser's own guides are `node_modules/phaser/skills/events-system/SKILL.md` and `data-manager/SKILL.md`.

## Who cleans up what at scene shutdown

| Emitter or owner | After `stop`, `restart` or `start` of its scene |
| --- | --- |
| `scene.input`, `scene.input.keyboard`, `scene.load`, `scene.physics.world` | Listeners removed |
| `scene.time` timers, `scene.tweens`, `scene.cameras`, display objects | Destroyed, with their listeners |
| `scene.events` (your `on` calls) | Kept; only `TRANSITION_*` listeners are removed |
| `scene.data` | Kept, values included |
| `game.events`, `game.scale`, `game.registry.events`, `game.textures`, `game.anims`, `game.sound`, DOM | Outlive every scene |

- [documented] `Systems#shutdown` removes only the transition listeners and emits `SHUTDOWN`; `Systems#destroy` removes all (`src/scene/Systems.js`). The plugin rows come from their own `shutdown` methods: `InputPlugin`, `KeyboardPlugin`, `LoaderPlugin`, `Clock`, `TweenManager`, `CameraManager`, `DisplayList`, Arcade `World`, and `DataManagerPlugin`, which only unhooks itself.
- [tested] After four restarts a listener added in `create` to `scene.events` and one added to `registry.events` each numbered five, and `scene.data` still held the count (`events-restart-keeps-scene-emitter-registry-and-scene-data`). Loader listeners were gone and a repeating `scene.time` event had stopped (`loader-listeners-end-with-the-scene`).
- [tested] `gameObject.destroy()` removes the listeners you attached to the object and emits `destroy(gameObject, fromScene)`; `fromScene` is `true` when the scene's own teardown destroys it, so skip tweens, sounds and spawns in that case (`events-destroy-reports-from-scene`).
- [tested] `emitter.off('event')` without a function removes every listener of that event, including other scenes' (`events-off-without-a-function-removes-every-listener`). Always pass the function and context you registered.

Remove everything in one handler by registering each subscription through a helper:

```ts
function disposables(scene: Phaser.Scene) {
  const offs: Array<() => void> = [];
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offs.splice(0).forEach((off) => off()));
  return (emitter: Phaser.Events.EventEmitter, event: string, fn: Function, ctx?: unknown) => {
    emitter.on(event, fn, ctx); offs.push(() => emitter.off(event, fn, ctx));
  };
}
// create(): const on = disposables(this); on(this.scale, Phaser.Scale.Events.RESIZE, this.layout, this);
```

## Prove it with a listener census

- [tested] Count listeners per event on every long-lived emitter, restart the scene ten times and require the census not to grow; the same function reports a deliberate leak and passes a clean scene (`events-census-catches-a-leak-and-passes-a-clean-scene`).

```js
const census = (game, scene) => JSON.stringify(Object.fromEntries(
  [['game', game.events], ['scale', game.scale], ['registry', game.registry.events], ['scene', scene.events], ['textures', game.textures], ['anims', game.anims]]
    .flatMap(([name, e]) => e.eventNames().map((k) => [`${name}:${String(k)}`, e.listenerCount(k)]))));
```

- [general] Add textures (`getTextureKeys().length`) and display objects (`children.length`) to the same assertion, as gotcha 14 asks.

## Where state lives

| State | Home | Not here |
| --- | --- | --- |
| Rules, world, saves | The headless sim ([architecture](architecture.md)) | `DataManager`, `registry` |
| Sim host, storage, settings that outlive scenes | A global plugin ([scenes 3](scenes-loop-and-plugins.md)) | Scene fields |
| Read models for the HUD (hp, score, paused) | `registry`, written when the sim event arrives | The source of truth |
| Scratch that dies with the scene | Scene fields, reset in `init()` | `scene.data` (it survives) |
| View tags on one object | `gameObject.setData` (destroyed with it) | References to sim objects |

- [tested] `DataManager#set` emits `changedata` on every set, equal value or not: four sets of `1` gave three events (`events-data-manager-emits-for-unchanged-values`). Write the registry when a value changes, not every frame.
- [documented] `get` returns the stored reference, so mutating a stored object emits nothing; `getAll` is a shallow copy, `reset` emits no events and `freeze` makes writes silent no-ops (`src/data/DataManager.js`).
- [general] Keep what a listener needs in its arguments; an event that says "something changed, go read the registry" hides ordering bugs.

## Passing data between scenes

- [documented] `scene.start(key, data)` and `launch(key, data)` store `data` by reference as `settings.data`; the scene reads it in `init(data)` and `create(data)`, or `sys.getData()` (`src/scene/Systems.js`).
- [tested] `Systems#start` assigns the data only when it is truthy, so `start('s')` and `restart()` reuse the previous call's data and `restart({})` clears it (`events-start-without-data-keeps-the-previous-data`). Pass the full object every time.
- [tested] Scenes should not read each other's fields (`scene.get('ui').hud`): after the other scene restarted, a reference held from before was a destroyed object (`active` false, `scene` undefined) and the field held a new one (`events-another-scenes-field-is-stale-after-it-restarts-and-start-returns-the-plugin-at-once`). Let both subscribe to the sim host or send a typed event through it.
- [tested] `start` has no return channel: `scene.start()` and `scene.restart()` only queue the change and return the scene plugin, so `init` and `create` had not run when the call returned (same check). Return a result to the caller by calling a method on the plugin or emitting through it.

## Save and load boundary

- [general] A snapshot is `sim.save()`: versioned, plain, JSON-safe data ([saves in architecture](architecture.md)).
- [tested] Do not serialise `registry.getAll()`, `scene.data` or game objects. They hold the live objects (`getAll().hud` was the same Text), and `JSON.stringify` does not throw: it writes each object's `toJSON` view dump (`name`, `type`, `x`, `y`, `scale`, `alpha`, `textureKey`, ...), where a Text's `textureKey` is a fresh uuid, so the output is neither the sim state nor reproducible (`events-registry-and-scene-data-hold-live-objects-and-json-of-an-object-is-a-view-dump`).
- [general] Restore in this order: build the sim from the snapshot, start the scenes, let views rebuild from the sim's state and events, then write the registry read models from the restored sim. A load must never write the registry first and trust it.

## Verify

- [tested] `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project> --only=events` runs the checks above (and `--only=loader-listeners` for the loader and timer row).
