# Scenes, plugins and the fixed-step loop (Phaser 4.2.1)

How to boot a game, split it into scenes, keep state out of them, and run rules at a fixed rate under Phaser's variable frame
delta. Each rule has the practice, the reason, a minimal generic example, what Phaser 4.2.1 really does (read from
`node_modules/phaser/src`), and where Fallow Valley demonstrates it (`example:` lines; repo `fallow-valley-next`, private).

## 1. Constants in one file, scenes with one job each

**Practice.** One `as const` object per kind of string key (scenes, textures, registry keys), one depth table, the tile and chunk
sizes. Give every scene one job: boot (UI assets only), preload (the big load, a progress bar), title, world, UI.

**Why.** A typo in a string key is a blank screen at runtime; the same typo in a constant is a compile error. A scene that owns one
thing can be restarted without losing anything.

```ts
export const SceneKey = { Boot: 'boot', Preload: 'preload', World: 'world', Ui: 'ui' } as const;
export const Depth = { Ground: 0, Objects: 3, Entities: 5, Roof: 10, Weather: 20 } as const;
```

example: fallow-valley-next `src/game/config.ts`, `src/main.ts`, `src/game/scenes/*`.

## 2. Ask for WebGL, fail loudly, with the smallest dependency

`type: Phaser.WEBGL` (not `AUTO`, which silently falls back to Canvas) when you use GPU tilemap layers or camera filters, and check
`this.renderer.type` in the first scene. Make the first scene load only what it needs to draw an error (two bitmap fonts and a
skin: kilobytes), so a failure can be shown in the game's own pixels; also mirror it to a visually hidden `aria-live` node. The
error path must not need the thing that failed.

`pixelArt: true` makes textures nearest-filtered, sets `antialias` false **and sets `roundPixels` true**
(`src/core/Config.js#L395`); stating `roundPixels: true` as well is redundant but documents intent.

example: `BootScene.ts`, `main.ts`.

## 3. State lives in a global plugin, not in scenes

**Practice.** Put the game (the headless sim) and storage in a global `BasePlugin`, register it with `mapping`, and let scenes read
it as `this.simHost`. Scenes subscribe through one method that removes the subscription on `SHUTDOWN`.

**Why.** Scenes restart, sleep and get replaced (the title's backdrop becomes the game). A plugin outlives all of them.

```ts
class SimHost extends Phaser.Plugins.BasePlugin {
  private sim: Sim | null = null;
  get current(): Sim { if (!this.sim) throw new Error('no game: call newGame() first'); return this.sim; }   // throw, never null
  bind(scene: Phaser.Scene, on: (e: SimEvent) => void): void {
    const off = this.current.events.onAny(on);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }
}
declare global { namespace Phaser { interface Scene { simHost: SimHost } } }
new Phaser.Game({ plugins: { global: [{ key: 'SimHost', plugin: SimHost, mapping: 'simHost', start: true }] } });
```

Verified: `PluginManager.addToScene` installs "references to Global Plugins that have a Scene mapping property into the Scene itself"
(`src/plugins/PluginManager.js#L227`). A global plugin is created once at boot; a scene plugin is created per scene.

Use `registry` (the game-wide `DataManager`) only for read models scenes publish (UI kit, atlases, integer zoom, a small
`{ capture, paused }` UI state), never for game state. example: `src/game/plugins/SimHostPlugin.ts`, `ui/UiState.ts`.

## 4. `start` hands off, `launch` runs beside; load shared assets once

- `scene.start(key, data)` stops the caller and starts the target; `scene.launch(key, data)` runs it in parallel
  (`src/scene/ScenePlugin.js#L212`, `#L481`). HUDs, debug panels and a title's live backdrop are launches.
- A scene that is still loading cannot be restarted (gotcha 11). So queue every asset the world draws in one function called by
  the preload scene; the loader skips keys already in the cache, so the world scene's own `preload` calling it again is free.
- To replace a running scene's state, pass a callback in the start data and run it first thing in the restarted scene's `init`,
  never from the scene that decided to start (gotcha 11).
- Every `game.events.on`, `scale.on`, `document.addEventListener` and sim subscription in a scene needs a matching removal in one
  `SHUTDOWN` handler (gotcha 14).

example: `scenes/PreloadScene.ts`, `scenes/worldAssets.ts`, `scenes/TitleScene.ts` (attract mode), `scenes/WorldScene.ts#create`.

## 5. The fixed-step loop and interpolation

**Practice.** Rules advance in fixed ticks (20 Hz is plenty for most games); the renderer runs at the display's rate and draws
`lerp(previous, current, alpha)`.

```ts
class FixedStepper {
  private acc = 0;
  constructor(readonly stepMs: number, readonly maxSteps = 5) {}
  advance(deltaMs: number, step: () => void): number {
    this.acc += Math.min(deltaMs, this.stepMs * this.maxSteps);        // cap catch-up: a stall must not spiral
    while (this.acc >= this.stepMs) { step(); this.acc -= this.stepMs; }
    return this.acc / this.stepMs;                                      // alpha in [0, 1)
  }
}
// scene.update(_t, delta): const alpha = stepper.advance(delta, () => { capturePrevious(); sim.step(); });
// view position = Phaser.Math.Linear(prev.x, sim.x, alpha) * TILE, then Math.round for pixel art
```

- **Capture the previous state inside the step callback, before the step.** A frame can run several steps.
- A pure class with no Phaser import: unit-test it (120 ms at a 50 ms step is two steps and alpha 0.4; a 60 s stall runs at most
  `maxSteps`).
- **Phaser's `delta` is smoothed.** `TimeStep.step` passes `smoothDelta(delta)` when `smoothStep` is true (the default): the mean of
  the last ten deltas, with any delta above `1000 / minFps` (200 ms) replaced by the last sane one (`src/core/TimeStep.js#L570`,
  `#L442`). That preserves the mean, so an accumulator is fine, but the `delta` you accumulate is not the real time of any one
  frame. `game.step(time, delta)` (`src/core/Game.js#L454`) does no smoothing: it runs pre-step, scene updates and render with the
  clock you give it, which is what makes deterministic tests possible (see [verifying](verifying-on-a-gpu.md)).
- **Camera follow lerps per frame, not per millisecond** (`startFollow(t, round, 0.2, 0.2)`), so frame counts change what the camera
  sees. If the view asks the sim for world chunks as the camera moves, the set of generated chunks depends on frame count: record
  generation events next to inputs when you need replay to match.
- **Hit stop** is skipping the step for 60 to 110 ms and reusing the last alpha; never touch the sim's clock. **Pause** is alpha 1
  and no steps. Teleports interpolate a streak for up to one tick unless you snap `prev`.
- Route the stepper call through **one tooling hook** (`advanceSim(stepper, delta, step)`) that is exactly `stepper.advance` unless a
  debug controller installs pause, step-N or time-scale. The whole test and demo harness then drives the real loop.
- Hold the loop when the page loses attention: Phaser pauses a hidden tab but not a blurred window (gotcha 15).

example: `src/game/loop/FixedStepper.ts`, `scenes/WorldScene.ts#update`, `debug/hooks.ts`, `tests/view-pure.test.ts`.

## 6. The headless boundary is a test

Commands in (`sim.dispatch`), typed events out (`sim.events`), view reads sim. Enforce with a test that scans `src/sim` and
`src/content` for `phaser`, `document`, `window`, `localStorage`, `Math.random(`, `Date.now(`, `new Date(`, `performance.now(`
(strip comments first). Add: content imports nothing from sim; every game file that uses a Phaser value at runtime imports it; the
files you want Node-testable (input maths, save store, remap rules, read models) contain no `phaser`. Details and the data-flow
diagram: [architecture](architecture.md). Where the view still reads sim internals or writes to it (an attract-mode clock), say so
in a Limits section of your own docs.

example: `tests/architecture.test.ts`, `src/sim/events.ts`, `src/game/view/*-math.ts` (pure files beside each Phaser class).

## 7. Fan-out, not a web

One subscription, many small `handle(event)` methods, each a `switch` on `e.type`:

```ts
this.simHost.bind(this, (e) => { streamer.handle(e); fx.handle(e); entityViews.handle(e); audio.handle(e); input.handle(e); });
```

Views never call each other. Adding a reaction is a file plus one name in the list. example: `WorldScene.create`.
