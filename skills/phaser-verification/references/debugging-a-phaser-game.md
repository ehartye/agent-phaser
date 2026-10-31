# Debugging a Phaser 4 game from a script

Read this when a Phaser game draws something wrong or nothing, and you can only run scripts: how to look inside it, what Phaser does not tell you, and which debug overlays lie. Backed by [`phaser-verification-pixels.mjs`](../../../examples/web/phaser-probes/phaser-verification-pixels.mjs). Measuring frame cost is a different job: [profiling method](profiling-method.md).

## Expose a handle and read plain data

- [general] Set `globalThis.__game = game` where the game is created, and load debug helpers only in dev or behind `?debug=1` ([loop and waiting](verifying-loop-and-waiting.md), [harness](../../../examples/web/harness)). Everything crossing `page.evaluate` must be plain data: return JSON, never a Phaser object.
- [tested] This reads the scene graph without side effects: scene key and status (`5` is `Phaser.Scenes.RUNNING`), then each object's type, name, position, depth, visibility, alpha and texture, walking containers through `list`:

```js
const describe = (scene) => {
  const walk = (o) => ({ type: o.type, name: o.name || undefined, x: Math.round(o.x), y: Math.round(o.y), depth: o.depth,
    visible: o.visible, alpha: o.alpha, texture: o.texture ? o.texture.key : undefined, children: o.list ? o.list.map(walk) : undefined });
  scene.children.depthSort();            // list order is draw order only after a sort
  return { key: scene.sys.settings.key, status: scene.sys.settings.status, objects: scene.children.list.map(walk) };
};
```

- [documented] Useful reads: `game.scene.getScenes(true)` (active scenes), `game.renderer.type` (1 Canvas, 2 WebGL), `game.renderer.gl`, `game.loop.actualFps` (a once-a-second average), `game.textures.getTextureKeys()` (omits `__DEFAULT`, `__MISSING`, `__WHITE` and `__NORMAL`), `game.cache.audio.exists(key)`, `scene.sys.settings.status` (`src/scene/const.js`, `src/textures/TextureManager.js`).
- [general] Add `name` to anything you will need to find. An unnamed `Rectangle` among two hundred is a coordinate guess.
- [tested] For descriptor-guided native input, the [control observation fixture](native-control-observation.md) derives bounds and revision facts from actual receiver registration. Its probe exercises real pointer/keyboard input, rejects stale/unsupported observations and retains failure reports. Eligibility does not certify authored paint.

## What Phaser does not tell you

- [tested] An unknown texture key does not log or throw: `add.image(x, y, 'typo')` shows the green `__MISSING` box and nothing reaches the console. Assert `scene.children.list.filter(o => o.texture && o.texture.key === '__MISSING')` is empty, walking containers.
- [tested] A failed audio decode is only a missing cache key and a console error; a missing marker is a warning and a `false` return ([testing audio](../../phaser-audio/references/testing-audio.md)).
- [general] Capture everything the browser says, then filter by pattern rather than by silence: `page.on('console')` for `error` and `warning`, `page.on('pageerror')`, `page.on('requestfailed')`, and `page.on('response')` for status 400 and up (a 404 asset is a loader failure, not a console line you can rely on). In the page, register `scene.load.on('loaderror', f => ...)` before the load starts and check `totalFailed` on `complete`.
- [documented] Phaser prints a banner with `console.log` unless you set `banner: false`; context loss and restore print `console.warn` lines (`src/renderer/webgl/WebGLRenderer.js`). Allow those by pattern, and fail on anything else.

## Debug draw

| Overlay | Turn on | Turn off | Trap |
| --- | --- | --- | --- |
| Arcade bodies | config `physics.arcade.debug: true`, or `world.createDebugGraphic()` | `world.drawDebug = false` then `world.debugGraphic.clear()` | setting only `drawDebug = true` throws on the next step; switching it off leaves the last frame on screen |
| Matter bodies | config `physics.matter.debug: true` or an options object | `world.drawDebug = false` and `world.debugGraphic.visible = false` | colours and `showBody`, `showJoint`, `showSensors` are options |
| Tilemap layer | `map.renderDebug(graphics, {tileColor, collidingTileColor, faceColor}, layer)` (`src/tilemaps/components/RenderDebug.js`) | destroy or clear that graphics | orthogonal maps only |
| Camera view | `graphics.strokeRectShape(cam.worldView)` | clear | none; draw in a scene above the world |

- [tested] Arcade: `drawDebug = true` without a graphic threw `Cannot read properties of undefined (reading 'clear')` from the physics step; after `createDebugGraphic()` a body outline read `[144, 16, 144]` at its edge (default body colour magenta `0xff00ff`, static `0x0000ff`, velocity `0x00ff00`); after `drawDebug = false` the same pixel still read `[144, 16, 144]` until `debugGraphic.clear()`.
- [documented] The Arcade debug graphic is created at depth `Number.MAX_VALUE` in the physics scene and redrawn every step (`src/physics/arcade/World.js`); Matter keeps its own `debugGraphic` and a `debugConfig` of colours (`src/physics/matter-js/World.js`). Debug drawing is per-body work each frame: switch it off before a timing run.
- [general] What the physics debug options mean and how to test bodies is in [phaser-physics](../../phaser-physics/SKILL.md).
- [general] Use an overlay to find the bug and a data read to prove the fix. An outline is anti-aliased, so asserting its pixel is fragile; assert the body's `x`, `y`, `width` and `height` from `body`, and use the overlay in the screenshot you attach.

## Screenshot or pixel read

- [general] A Playwright screenshot answers "what does the player see", including DOM overlays, CSS scale and device pixel ratio; a `snapshotPixel` read answers "what colour did the game draw here" without the compositor. Reach for the pixel read first for a logic claim, and the screenshot for evidence and golden images ([pixel assertions](visual-and-pixel-assertions.md)). Never read the canvas with `toDataURL` after the frame: it is black.

## Inspectors

- [documented] Phaser's published debug tools are a browser extension that lists scenes and edits display-list properties (announced for Phaser 3, October 2024) and a data-manager inspector (announced December 2025, aimed at Phaser 3) ([debug tool](https://phaser.io/news/2024/10/phaser-debug-tool), [data inspector](https://phaser.io/news/2025/12/phaser-data-inspector)). Neither was checked against 4.2.1, and extensions need a headed browser, so a script cannot use them.
- [tested] The npm bundle's `renderer.spector` is `null`: the embedded Spector.js capture only exists in a custom build with the `WEBGL_DEBUG` flag (`src/renderer/webgl/WebGLRenderer.js`). For a draw-by-draw view install the Spector.js extension in a headed browser, or count draw calls by wrapping `gl.drawElements` ([performance](performance.md)).
- [general] Playwright's trace (`trace: 'retain-on-failure'`) records DOM snapshots, console and network around a failure; the canvas appears as a screenshot, so pair it with a pixel read.
