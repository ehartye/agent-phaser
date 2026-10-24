# Leak and lifecycle tests for a Phaser 4 game

Read this before you write the scene-restart leak test the skill requires, or before you trust that a level change cleaned up. Phaser removes what it owns and nothing else, so a leak is almost always a listener, texture or sound you added. Backed by [`phaser-verification-leaks.mjs`](../../../examples/web/phaser-probes/phaser-verification-leaks.mjs).

## The restart recipe

- [general] The steps: boot, then wait for the first `postrender` (not just `create`); read the counters below as the baseline; restart the scene ten times, waiting for each `create` (a counter your `create` increments), then wait for one more `postrender`; read the counters again. Every number must equal the baseline; print the ones that grew.

```js
const counters = (game) => {
  const scene = game.scene.getScenes(false)[0];
  const names = (e) => Object.fromEntries(e.eventNames().map((n) => [String(n), e.listenerCount(n)]));
  return {
    children: scene.children.length, tweens: scene.tweens.getTweens().length,
    timers: scene.time._active.length + scene.time._pendingInsertion.length,
    textureKeys: game.textures.getTextureKeys().length, glTextures: game.renderer.glTextureWrappers.length,
    gameEvents: names(game.events), sceneEvents: names(scene.events), scale: names(game.scale), registry: names(game.registry.events),
    sounds: game.sound.sounds?.length ?? 0, scenes: game.scene.scenes.length,
  };
};
```

- [tested] Ten restarts of a scene that built a text object, a particle emitter, a looping tween and timer, pointer and key listeners, a physics body and a few rectangles left `children`, `tweens`, `timers`, `textureKeys` and `glTextures` at their baseline, and every listener count on `game.events`, `scale`, `registry` and the scene's own events flat.
- [documented] `Clock._active` and `_pendingInsertion` are private (`src/time/Clock.js`) but are the only count of scene timers; `getTweens()` returns a copy of the manager's list (`src/tweens/TweenManager.js`). Wrap them in one helper so a rename breaks one place.
- [general] `scene.children.length` counts top-level objects; a container's members are in `container.list`. Count what your game adds, and compare keys, not only totals.

## What a restart does not clean

| You added | Counter that grows | Fix |
| --- | --- | --- |
| `game.events.on(...)` | `gameEvents.<name>` | `off` in a `shutdown` handler |
| `this.scale.on('resize', ...)` | `scale.resize` | same; the scale manager is the game's |
| `this.registry.events.on(...)` | `registry.<name>` | same; the registry is the game's |
| `this.events.on('update', ...)` | `sceneEvents.update` | `off`; the scene's emitter outlives the restart |
| `textures.addCanvas('c' + n)` | `textureKeys`, `glTextures` | check `textures.exists(key)`; reuse or `remove` |
| `sound.add(key)` per start | `sounds` | reuse by key ([loops and scene lifetime](../../phaser-audio/references/loops-and-scene-lifetime.md)) |

- [tested] Each row grew by exactly 10 over ten restarts, and a `this.events.once('shutdown', () => { ...off... })` handler that removed the same listeners made every counter flat again. A listener on `this.events` leaks too: the scene's emitter persists across a restart.

```js
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  game.events.off('postrender', onRender); this.scale.off('resize', onResize);
  this.registry.events.off('changedata', onData); this.events.off('update', onUpdate);
});
```

- [general] Use `once('shutdown')`, not `on`, so the cleanup itself does not stack.

## GL resources and dynamic textures

- [documented] `renderer.glTextureWrappers` holds a wrapper per GL texture; a destroyed texture that leaves its wrapper behind (`wrapper.renderer === null`) breaks context restore. The known cases and their counters are [gotchas 13 and 24](../../phaser-rendering/references/phaser-4-webgl-context-gotchas.md) and [25](../../phaser-rendering/references/phaser-4-renderer-destruction-gotchas.md); the assertion list is in [assertions and harness](verifying-assertions-and-harness.md).
- [tested] A texture added under a new key on each restart grew `textureKeys` and `glTextures` by one each.
- [general] Heap numbers (`performance.memory`) are noisy; use them only after the counters are flat and a leak is still suspected.

## Game create and destroy

- [documented] `VisibilityHandler` adds a `visibilitychange` listener to `document` and never removes it (`src/core/VisibilityHandler.js`).
- [tested] A listener ledger (a patched `addEventListener` and `removeEventListener`, installed with `page.addInitScript`) showed five `document` `visibilitychange` listeners after five `new Phaser.Game` and `game.destroy(true)` cycles, with no canvas left in the DOM. The cost is small and unbounded; hold one Game per page and reuse it, or expect it in hosts that remount a Game (hot reload, tabbed apps).

```js
// page.addInitScript: net listeners per target and type; read window.__ledger() before and after.
const ledger = new Map(), add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const name = (t) => (t === window ? 'window' : t === document ? 'document' : t.nodeName || t.constructor.name);
const cap = (o) => (typeof o === 'object' && o !== null ? !!o.capture : !!o);
EventTarget.prototype.addEventListener = function (type, fn, o) {
  const k = `${name(this)}|${type}`; if (!ledger.has(k)) ledger.set(k, []);
  if (!ledger.get(k).some((e) => e[0] === this && e[1] === fn && e[2] === cap(o))) ledger.get(k).push([this, fn, cap(o)]);
  return add.call(this, type, fn, o);
};
EventTarget.prototype.removeEventListener = function (type, fn, o) {
  const l = ledger.get(`${name(this)}|${type}`), i = l ? l.findIndex((e) => e[0] === this && e[1] === fn && e[2] === cap(o)) : -1;
  if (i >= 0) l.splice(i, 1); return remove.call(this, type, fn, o);
};
window.__ledger = () => Object.fromEntries([...ledger].filter(([, l]) => l.length).map(([k, l]) => [k, l.length]));
```

## Context loss and restore

- [documented] `WebGLRenderer` listens for `webglcontextlost` and `webglcontextrestored`, sets `renderer.contextLost`, emits `Phaser.Renderer.Events.LOSE_WEBGL` (`'losewebgl'`) and `RESTORE_WEBGL` (`'restorewebgl'`), and logs a `console.warn` for each (`src/renderer/webgl/WebGLRenderer.js`). Rendering and snapshots stop while it is lost.
- [tested] The test hook is `gl.getExtension('WEBGL_lose_context')`: `loseContext()`, wait for `renderer.contextLost`, `restoreContext()`, wait for it to clear. After a restore the scene and a `CanvasTexture` drew again; a `RenderTexture` read `[0, 0, 0]` until it was filled and rendered again; both transitions warned, and a scene containing a RenderTexture also logged two `INVALID_OPERATION: delete` warnings.
- [general] Assert four things: both events fire in order, `contextLost` clears, the scene redraws (a known pixel), and your handler on `RESTORE_WEBGL` redraws every `RenderTexture`. Allow the expected warnings by pattern in a zero-warning fixture, and fail on any other. A guarded patch for the framebuffer case is [rendering gotcha 23](../../phaser-rendering/references/phaser-4-webgl-context-gotchas.md).
