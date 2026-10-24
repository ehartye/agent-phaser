# Pointer and mouse in Phaser 4.2.1: routing, hit areas, coordinates and the canvas defaults

Where a press goes when several scenes, cameras and DOM elements are involved, and the defaults that surprise a UI. Reproduce
the tested facts with `node examples/web/phaser-probes/phaser-input-pointer.mjs <project>` (Canvas renderer, mouse and
CDP touch, no GPU). Phaser's overview is `node_modules/phaser/skills/input-keyboard-mouse-touch/SKILL.md`; touch design is in
[touch input and design](touch-input-and-design.md).

## Routing between scenes

| Call | Scope | Effect |
| --- | --- | --- |
| `event.stopPropagation()` (last argument of an object handler) | the current scene | skips the remaining objects and that scene's own `pointerdown` |
| `this.input.stopPropagation()` | all scenes below | the manager skips them for this one event |
| `game.input.globalTopOnly = false` | the game | every scene hears every event |
| `scene.input.topOnly = false` | one scene | every object under the pointer, not only the top one |

- [documented] The rows above are read from `InputPlugin#update`, `InputPlugin#stopPropagation` and `InputManager#updateInputPlugins`
  (`src/input/`); the first two are reproduced below.
- [tested] With the default `globalTopOnly = true`, an interactive object under the pointer in an upper scene hides the press from
  every lower scene, including their scene-level `pointerdown`; an upper scene with no object under the pointer hides nothing, and
  its own scene-level listener never blocks. This contradicts the common assumption that a UI scene's button leaves the world
  scene informed: the world needs `input.globalTopOnly = false` or its own flag.
- [tested] `this.input.stopPropagation()` inside a scene-level `pointerdown` hides that press from lower scenes but not the later
  `pointerup`, so a lower scene can see an up with no down. Record at down which scene owns each pointer id and honour it at up.
- [documented] Objects are tested per camera, top camera first, and only if they would render to that camera; ties are ordered by the
  camera's render list, so display order is click priority. `camera.inputEnabled = false` removes a camera from hit testing
  (`src/input/InputPlugin.js#hitTestPointer`, `src/cameras/2d/CameraManager.js#getCamerasBelowPointer`).
- [documented] A press that began outside the canvas element emits `POINTER_DOWN_OUTSIDE` instead of `POINTER_DOWN`, and a release
  over another element emits `POINTER_UP_OUTSIDE`, while object-level `pointerdown` and `pointerup` still run for the object under
  the coordinates.

## Hit areas

- [tested] A `BitmapText` hit area keeps the size it had when `setInteractive()` ran: a label that grew from 6 to 24 px kept a 6 px
  target, while a `Text` hit area followed its text. Fix: after `setText` call
  `label.input.hitArea.setSize(label.width, label.height)`, or give the label a `Zone` of the cell size.
- [documented] Only objects that write `input.hitArea` when they are sized resize it, and only while `customHitArea` is false:
  Text, NineSlice, TileSprite, the Rectangle shape, Zone, Video, RenderTexture and the Size component. BitmapText and Graphics are
  not on that list (a search for `customHitArea` under `src/gameobjects`).
- [tested] A `Container` needs `setSize` before `setInteractive`, and its hit area is centred on its position (`displayOriginX` is
  half the width): children laid out from local (0, 0) sit half a size away from their own hit area. Offset the rectangle or use a
  `Zone` child.
- [documented] `setInteractive()` on a non-Container whose width or height is 0 creates no input and no warning; an empty
  `BitmapText` falls back to the font texture frame size. Pixel-perfect testing is refused on a Container
  (`src/input/InputPlugin.js#setHitArea`).
- [documented] Never destroy and recreate an interactive object between press and release; see
  [scene lifecycle gotchas](../../engine-phaser/references/phaser-4-scene-lifecycle-gotchas.md).

## Coordinates

- [documented] `pointer.x` and `pointer.y` are canvas pixels: `(pageX - canvasBounds.left) * displayScale`
  (`src/scale/ScaleManager.js#transformX`). A device-pixel canvas with `zoom = 1 / dpr` already reports device pixels.
- [tested] `pointer.worldX` and `worldY` are written when a pointer event is hit tested. Scrolling the camera while the mouse is
  still left them at 100 when the true value was 140; call `pointer.updateWorldPoint(camera)` (or `camera.getWorldPoint`) each
  frame you aim with the mouse.
- [tested] `camera.getWorldPoint` reads the matrix built by the last render: right after `setZoom(2)` it returned the old answer
  (100), one frame later the right one (130 on a 320 px canvas). Wait a frame or call `camera.preRender()` after changing zoom or
  scroll in the same tick (it returned 130 at once).
- [tested] A 20 px header inserted above the canvas moved it without resizing its parent: the next press reported y 100 instead
  of 80 until the `resizeInterval` poll (500 ms) ran, and `game.scale.updateBounds()` fixed it at once. Call it after you move or
  reveal things around the canvas.
- [documented] With several cameras, `pointer.camera` is the camera of the last hit test; for a UI camera at another zoom use
  `pointer.positionToCamera(camera)` instead of `worldX`.

## Mouse defaults

- [documented] The canvas calls `preventDefault` on mousedown, mouseup, mousemove and wheel by default (`input.mouse.preventDefaultDown`,
  `preventDefaultUp`, `preventDefaultMove`, `preventDefaultWheel`, all true in `src/core/Config.js`).
- [tested] Consequences: a click on the canvas does not blur a focused DOM `<input>` (`phaser-pixel-ui-panels.mjs` clicks the canvas
  with a field focused), and the page cannot scroll with the wheel over the canvas. Set
  `input: { mouse: { preventDefaultDown: false, preventDefaultWheel: false } }` to restore both.
- [tested] `MouseManager#stopListeners` never removes the `wheel` listener. A destroyed game's handler stays on its canvas, the
  canvas pool hands the same element to the next game, and wheel scrolling stays cancelled although the new game opted out.
  Fix: pass a fresh canvas element (`canvas: document.createElement('canvas')`) when games are created and destroyed in one page,
  as tests and hot reload do.
- [tested] Hover is evaluated on pointer events only (`pollRate` is -1): an object that appears under a stationary cursor gets no
  `pointerover` until the mouse moves, unless the scene calls `input.setPollAlways()`. Menus that open under the cursor need it,
  or an explicit "first focus" rule.
- [documented] Pointer lock: `input.mouse.requestPointerLock()` needs a user gesture; while locked `pointer.movementX` and
  `movementY` carry the motion (read them, not `x` and `y`); `POINTERLOCK_CHANGE` reports the state
  (`src/input/mouse/MouseManager.js`, `src/input/Pointer.js#move`). `input.mouse.disableContextMenu()` stops the right-click menu.

## DOM elements above the canvas

- [tested] A mouse or touch press on a DOM element positioned over the canvas is also delivered to Phaser (window listeners), so
  the interactive object underneath is pressed too. Stop it at the element: call `stopPropagation()` for `mousedown`, `mouseup`,
  `touchstart`, `touchend` and `touchcancel`. Details in
  [DOM overlays and forms](../../phaser-pixel-ui/references/dom-overlays-and-forms.md).
- [tested] `input.activePointers` defaults to 1 (a mouse pointer plus one touch pointer); a second finger is ignored until
  `activePointers: 3` or `input.addPointer(n)`.
- [documented] `addPointer` stops at 10 touch pointers (`src/input/InputManager.js#addPointer`).
- [tested] `touchcancel` arrives as an ordinary `pointerup` at object and scene level with `pointer.wasCanceled === true`; check it
  before activating anything. Chromium also logs an "Ignored attempt to cancel a touchcancel event" console message because the
  handler calls `preventDefault` on a non-cancelable event, so a "no console errors" gate must allow it.

## Links

[keyboard](keyboard.md), [input architecture](input-architecture.md), [touch and mobile](touch-and-mobile.md),
[cameras](../../phaser-worlds/references/cameras.md) (converting with the camera you mean).
