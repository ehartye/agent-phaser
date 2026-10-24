# Scale, resize and device pixels (Phaser 4.2.1)

Choose a scale mode, keep pixels honest on dense screens, react to resizes and test the matrix. The numbers below were measured in Chromium with the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs) (check ids in brackets); Phaser's own guide is `node_modules/phaser/skills/scale-and-responsive/SKILL.md`.

## Pick a mode

A 320x180 game with `pixelArt` in an 800x600 parent:

| Mode | Canvas CSS size | Use it for |
| --- | --- | --- |
| `NONE`, `zoom: 2` | 640x360 | Fixed integer scale; you call `scale.resize` or `setZoom` when the window changes |
| `FIT` | 800x450 (x2.5) | Art that tolerates a fractional scale |
| `FIT` + `snap: {width: 320, height: 180}` | 640x360 (x2) | Integer letterbox for pixel art |
| `ENVELOP` | 1066.7x600, centred by a negative margin | Backdrops that may be cropped |
| `EXPAND` | 800x600, and the game size becomes 320x240 | Wide range of aspect ratios; lay out from `scale.width` and `scale.height` |
| `RESIZE` | 800x600, game size 800x600 | Tools and UI-heavy apps that re-layout on every resize |

- [tested] Those sizes (`scale-modes-at-800x600`).
- [documented] `pixelArt` sets the canvas to nearest-neighbour (`image-rendering: pixelated`, `src/display/canvas/CanvasInterpolation.js`). [general] So a x2.5 canvas shows source pixels two and three device pixels wide in turn; pixel art needs an integer scale.
- [tested] `zoom: MAX_ZOOM` is reported (`scale.zoom` is 2) but `FIT` ignores it and stays at x2.5; zoom only drives `NONE`. Phaser's bundled guide pairs `FIT` with `MAX_ZOOM` for pixel art; use `snap` instead.
- [tested] `snap` floors the display to multiples of the base size, so a parent smaller than the game collapses the canvas to 0x0 unless `min: {width: 320, height: 180}` is set (`scale-snap-collapses-below-one-x-unless-min-is-set`).
- [documented] The `ScaleManager` owns the canvas style (`width`, `height`, margins for `autoCenter`), so style the parent, not the canvas. With `expandParent` (true) it sets `html` and `body` height to 100% when the parent is the body or has no height. The parent is measured with `getBoundingClientRect`, which includes padding and border, so pad a wrapper instead (`src/scale/ScaleManager.js`).

## Sizes and the pointer

- [documented] `scale.gameSize` is what you lay out in (`scale.width`, `scale.height`), `baseSize` is the canvas attribute size, `displaySize` the CSS size and `parentSize` the measured parent. Pointer coordinates are `(page - canvasBounds) * displayScale`, where `displayScale` is base size over CSS bounds, so letterbox margins and CSS scaling are already handled (`transformX`, `transformY`).
- [general] Never read `window.innerWidth` for game layout; read `scale.width`, `scale.height` or the `RESIZE` event, so tests that stub the parent still work.

## Device pixel ratio

- [tested] `ScaleManager` has no device-pixel-ratio handling: `RESIZE` at DPR 2 makes an 800x600 canvas in an 800x600 CSS box, which the browser then upscales (`scale-resize-mode-ignores-device-pixel-ratio`).
- [documented] The ratio is only recorded as `game.device.os.pixelRatio` (`src/device/OS.js`).
- [tested] To back the canvas with device pixels use `NONE`: `width = round(cssWidth * dpr)`, `height = round(cssHeight * dpr)`, `zoom: 1 / dpr`; the CSS box stays 320x180 and the backing store is 320x180 times the ratio at DPR 1, 1.5 and 2 (`scale-none-with-reciprocal-zoom-matches-device-pixels`). Recompute on `RESIZE` and when the ratio changes (browser zoom, moving between monitors).
- [general] Crisp pixel art also needs a whole number of device pixels per source pixel, chosen per layer; that policy and the camera code are in [pixel-perfect footprint](../../phaser-pixel-ui/references/pixel-perfect-footprint.md).

## Resize events and cameras

- [documented] `scale.on(Phaser.Scale.Events.RESIZE, (gameSize, baseSize, displaySize, previousWidth, previousHeight) => ...)` fires for every refresh. The renderer follows; a camera follows only if it sits at (0, 0) and had the previous game size (`CameraManager#onResize`).
- [tested] A second camera with its own viewport (a HUD or minimap) keeps its size when the window changes; resize it in your handler (`scale-only-matching-cameras-follow-a-resize`).
- [tested] A window resize refreshes at once, without waiting for the poll (`scale-window-resize-is-immediate`).
- [documented] The 4.2.1 changelog lists "Fix ScaleManager not resizing to parent container" (issue 7213); the `resize` listener in `startListeners` now carries a marked fix block that calls `getParentBounds()` and `refresh()`. I did not run 4.2.0 to see the earlier behaviour.
- [tested] A parent resized by CSS alone (a collapsing sidebar) is noticed only by the poll, every `resizeInterval` (500 ms, `scale-default-poll-catches-parent-change`). To react at once call `scale.getParentBounds()` and then `scale.refresh()`; `refresh()` alone re-applies the stale parent size (`scale-parent-css-change-needs-bounds-then-refresh`). With `parent: null` there is no poll; call `scale.setParentSize(w, h)`.
- [general] Keep layout a pure function `layout(width, height)` that you unit-test, call it from `create` and from the handler, and remove the handler on `SHUTDOWN` (`scale` outlives scenes; see [events and data](events-and-data.md)).

## Fullscreen and orientation

- [documented] `startFullscreen()` must run inside a user-gesture handler (`pointerup` is the reliable one on touch). Without `fullscreenTarget` it moves the canvas into a temporary div and back, so the canvas's parent changes while fullscreen; set `fullscreenTarget` to the existing parent. It emits `ENTER_FULLSCREEN`, `LEAVE_FULLSCREEN`, `FULLSCREEN_FAILED` or `FULLSCREEN_UNSUPPORTED` (`src/scale/ScaleManager.js`). [general] An iframe needs `allowfullscreen`.
- [tested] `scale.lockOrientation()` calls only the removed `screen.lockOrientation` and returns `false` in current Chromium (`scale-lock-orientation-is-legacy-only`). [general] Call `screen.orientation.lock('landscape')` from a gesture, usually while fullscreen, and handle the rejection.
- [documented] `scale.orientation`, `isPortrait` and `isLandscape` describe the device; `isGamePortrait` and `isGameLandscape` describe the game size; `Events.ORIENTATION_CHANGE` fires on change.

## Test the matrix

- [general] Run a table of viewport sizes times device-pixel ratios `1`, `1.5`, `2` (`browser.newContext({ viewport, deviceScaleFactor })`) and, for each, assert `canvas.width`, the canvas bounding box, `scale.width` and every camera's size. Wait on the `RESIZE` event or a state flag, never on a fixed delay.
- [tested] `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project> --only=scale` runs the checks cited above. For the pixel footprint on a real GPU use [source-pixels.mjs](../../../examples/web/phaser-probes/source-pixels.mjs).
