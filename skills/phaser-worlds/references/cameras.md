# Cameras in a scrolling Phaser 4 world

How the 4.2.1 camera behaves when the world is bigger than the screen: what its numbers mean, how follow and snapping work at zoom, and what a second camera costs. Phaser's own camera API tour is `node_modules/phaser/skills/cameras/SKILL.md`; this adds the traps and the numbers.

Probe: `node examples/web/phaser-probes/phaser-worlds-cameras.mjs /path/to/host-project` (host has phaser 4.2.1 and playwright). Every [tested] bullet below is a check in [the probe](../../../examples/web/phaser-probes/phaser-worlds-cameras.mjs).

## Pick the setup

| Need | Setup | Watch for |
| --- | --- | --- |
| World plus HUD | `cameras.main` for the world; HUD in its own scene with its own camera | `setScrollFactor(0)` is not a HUD under zoom |
| Minimap | `cameras.add(x, y, w, h).setZoom(0.2)`; HUD and minimap `ignore` each other's objects | the world is processed twice |
| Split screen | one camera per viewport, each with its own bounds and follow | one full pass per camera |
| Grade or blur the world | camera filter on the world camera only, or a filter on a world `Layer` ([layers](world-streaming-and-layers.md)) | filter list belongs in [phaser-rendering](../../phaser-rendering/SKILL.md) |

```ts
// world scene: one camera, pixel-art safe follow
const cam = this.cameras.main.setBounds(0, 0, mapW, mapH).setZoom(3);
cam.startFollow(playerView, true, 0.15, 0.15);       // true keeps roundPixels on
// minimap: a second camera that skips the HUD, while the main camera skips the minimap frame
const mini = this.cameras.add(W - 104, 4, 100, 75).setZoom(100 / mapW).centerOn(mapW / 2, mapH / 2);
mini.ignore(hudLayer); cam.ignore(miniFrame);
```

- [documented] Camera ids are bit flags, so about 31 cameras can exclude objects; later ones get id 0 and cannot (`src/cameras/2d/CameraManager.js#getNextID`).
- [tested] `camera.ignore(layer)` marks the Layer itself, so children added later stay hidden. `ignore(group)` marks only the children present at the call, so a late child still draws. `ignore(container)` skips the container and so its children.
- [tested] Removing a camera does not clear its bit from the objects that ignored it, and the next `cameras.add` reuses the id: a new minimap silently inherits the old exclusions. Clear `cameraFilter` yourself or keep one long-lived camera per role.

## What the numbers mean

- [tested] With zoom 2, `setScroll(100, 50)` gives `worldView.x = 200`, not 100. Scroll pans the centre of the view: `worldView.x = scrollX + width / 2 - width / (2 * zoom)`. Never use `scrollX` as the left edge when zoom is not 1.
- [tested] `worldView` is rewritten in the camera's `preRender`, during render. After `setScroll` it is stale until the next frame, so a streamer reading it in `update` lags one frame. Stream from the follow target plus a margin of one chunk, or compute the view from scroll, zoom and size yourself.
- [tested] `worldView` ignores camera rotation (400x300 stays 400x300 at 0.6 rad), and a CPU tile layer drew the same tile count at 0.6 rad as at 0.
- [documented] Tile culling (`src/tilemaps/components/CullBounds.js`) and light culling (`LightsManager#getLights`) read `worldView`, so tiles and lights near the corners of a rotated view can be dropped.
- [tested] Bounds smaller than the view pin the scroll to the bounds origin; they do not centre. At zoom 2 the left bound edge is `worldView.x = 0` with `scrollX = -100`, so negative scroll is normal at a bound.
- [tested] `camera.getWorldPoint(pointer.x, pointer.y)` includes viewport offset and zoom. `pointer.worldX/Y` is only a side effect of input hit tests: with a minimap under the pointer it still held the main camera's mapping (375, 145 against the minimap's 50, 47.5). Always convert with the camera you mean.
- [tested] World to screen without rotation: `(worldX - cam.worldView.x) * cam.zoom + cam.x` hit the object at zoom 2 and 4 with a viewport offset (scroll alone missed). Use it to pin a UI label to a world object.

## Following

- [documented] Follow runs inside `preRender` (`src/cameras/2d/Camera.js#L553`), after `update` and physics, using the target's position at render time. Follow the display object you draw (the interpolated one), not the simulation position.
- [tested] `startFollow(target)` with default arguments sets `camera.roundPixels = false`, overriding `pixelArt: true`. Pass `true` as the second argument: `startFollow(t, true, lerp, lerp)`.
- [documented] Lerp is applied per rendered frame (`Linear(scroll, target, lerp)`), so a fixed 0.1 follows faster at 144 Hz than at 60.
- [tested] Make it time based with `cam.setLerp(1 - Math.exp(-dt / tau))` every frame: 0.9817 of the distance after 1 s at 30, 60 and 144 fps, against 0.958 to 1 for a fixed 0.1.
- [documented] `followOffset` is subtracted from the target (`target.x - offset.x`). A running pan effect suspends follow. A deadzone only moves the camera when the target leaves the rectangle.

## Pixel snapping at zoom

- [tested] With `roundPixels: true`, zoom 3 and scroll 0.3, an Image at x 10.4 got the fractional screen x -369.7: no snapping. Default `safeAuto` rounds only when the camera-times-object matrix is a pure translation, so zoom, scale, rotation or flip turn it off. `fullAuto` snapped it to -370.
- [documented] Phaser's changelog states the intent: roundPixels should "only operate when objects are axis-aligned and unscaled" (`changelog/v4/4.0/CHANGELOG-v4.0.0.md`).
- [documented] `camera.renderRoundPixels` is read only by the Canvas renderer (`src/renderer/canvas/CanvasRenderer.js#L836`); WebGL decides per object through `vertexRoundMode` (`src/gameobjects/GameObject.js#willRoundVertices`).
- [tested] For a fractional zoom or a rotating camera, Phaser's guide recommends `render.smoothPixelArt: true` over rounding. Measured at zoom 3.5 and 4.5, rotated or not: one-pixel blended edges, 74 to 84 percent of a 7 to 9 pixel texel exact; `pixelArt` is exact but uneven ([pixel-art filters](../../phaser-rendering/references/pixel-art-filters.md)). The GPU tile layer does too.
- [tested] At an integer footprint (zoom 3, art scale 1) texels land in equal 3 px blocks at any position; 100.4 against 100.6 moved the sprite one device pixel, not one art pixel. If that jitters, draw entities at `Math.round` positions or set `setVertexRoundMode('fullAuto')` on them. Footprint rules are in [phaser-pixel-ui](../../phaser-pixel-ui/SKILL.md).

## Shake, flash, fade, pan

- [tested] Shake uses `Math.random` every frame and rounds the offset only when `camera.roundPixels` is on. The offset already includes zoom and `matrix.translate` multiplies by zoom again (`src/cameras/2d/effects/Shake.js`): at zoom 3 an offset of 10 moved the view 30 device pixels and the picture by 30 and 21 (checks 6, 6b), whole multiples of the zoom, so a rounded step is a whole art pixel at integer zoom and intensity grows with zoom squared. It smears only with `roundPixels` false (`startFollow(target)` resets it unless you pass `true`) or a fractional zoom (arithmetic). A hand-shaped alternative: gotcha 12 in [phaser-rendering](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md).
- [documented] Flash and fade are filled by the camera render node after its children (`src/renderer/webgl/renderNodes/Camera.js`), so they cover that camera only; a UI camera or scene is not flashed.

## Cost and culling

- [tested] Nothing culls Images or Sprites by position. 200 far-offscreen images made 200 transformer runs a frame, as on screen; `setVisible(false)` made 0; a second camera doubled the count. Ten thousand images cost about 1 ms of CPU on screen or far off and 0 ms hidden (software GL; compare ratios).
- [documented] `BaseCamera.cull()` has no caller anywhere in `src/` in 4.2.1. What culls: CPU tilemap layers (worldView plus one tile), lights (circle against worldView, `LightsManager#getLights`), and a `ParticleEmitter` with `viewBounds`.
- [documented] A camera with `alpha < 1`, `forceComposite` or any active filter renders into a framebuffer (`useFramebuffers` in the camera render node): one extra full-camera target per such camera.
- [general] Hide what is far away yourself, by chunk ([layers](world-streaming-and-layers.md)). Draw a minimap from sim data into a small texture a few times a second instead of a second world pass.

## Traps

- [tested] `setScrollFactor(0)` is not a HUD at zoom other than 1: with zoom 3 on a 400x300 camera an object at (10, 10) drew at (-370, -270), because zoom scales about the viewport centre. Use a UI scene with its own camera.
- [documented] `CameraManager#onResize` only resizes a camera at (0, 0) whose size equalled the previous game size, so a minimap or split viewport must be repositioned by your own `resize` handler (`src/cameras/2d/CameraManager.js`).
- [general] Verify cameras by numbers: `await frames(1)`, then assert `worldView`, `getWorldPoint` and one pixel read ([verifying](../../phaser-verification/references/verifying-on-a-gpu.md)).
