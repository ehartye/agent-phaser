# UI layout, hit areas, focus and navigation in Phaser 4.2.1

How to lay out screens, keep targets and focus apart from paint, and make every menu work from keyboard and controller. The
focus helper is [spatial-focus.mjs](../scripts/assets/spatial-focus.mjs), covered by `node --test tests/phaser-pixel-ui-focus.test.mjs`.
Pointer facts are in [pointer and mouse](../../phaser-input/references/pointer-and-mouse.md); the pad-to-keys navigator and the
spatial rule in prose are in [gamepad and input](../../phaser-input/references/gamepad-and-input.md).

## What Phaser gives for layout

- [documented] There is no layout engine. `Container` is a transform group with no size until `setSize`; `Layer` (a real
  `GameObject` since 4.1.0) groups for depth and filters but has no transform (`src/gameobjects/layer/Layer.js` mixins). The helpers
  are `Phaser.Actions.GridAlign`, `AlignTo`, `Phaser.Display.Align.In.*` and `To.*`, and `Phaser.Display.Bounds.*`.
- [tested] `Align.In.Center` put a 3 px object in a 20 px box at x 8.5, a half pixel. Helpers that centre use `width / 2`, so with
  odd sizes they leave whole coordinates. Compute positions in your own pure `layout(width, height)` and floor them
  (`Math.floor((outer - inner) / 2)`); call it from `create` and from the `RESIZE` handler, and unit-test it over the supported sizes.
- [general] Lay out in logical pixels of the UI camera, anchor to edges with named insets (safe area, margin), and give every
  region a rectangle owner: the panel rectangle comes from the layout, the label and icon rectangles come from the panel.

## Paint, hit and focus are three rectangles

- [general] Give every control `paint` (what is drawn), `hit` (what receives presses) and `focus` (what the ring surrounds). A small
  painted face needs a full-size target: use a `Zone` of at least `ceil(44 * canvasPerCss / S)` logical pixels, and draw the ring
  around the paint rectangle or the hit rectangle consistently ([touch input and design](../../phaser-input/references/touch-input-and-design.md)).
- [tested] A sized `Container` hit-tests from its centre (`displayOriginX = width / 2`), a `BitmapText` keeps its first hit size, and
  hover is not evaluated under a stationary pointer until it moves or the scene calls `setPollAlways()`. A fixed-size `Zone` avoids
  the first two, so a `Zone` per control is the default; like any origin-0.5 object it is centred on its position, so call
  `setOrigin(0, 0)` to place it by its corner (`src/gameobjects/zone/Zone.js` has the Origin component).
- [documented] Never destroy and recreate interactive objects in response to input; build zones once per layout and update them in
  place ([scene lifecycle gotchas](../../engine-phaser/references/phaser-4-scene-lifecycle-gotchas.md), 19).
- [documented] `Zone`, `NineSlice` and the `Rectangle` shape resize their default hit area in `setSize`, and `Text` does so when it
  re-renders; other objects need `input.hitArea.setSize(...)` after a resize ([panels](panels-nine-slice-and-graphics.md)).

## Keyboard and controller focus

- [documented] Phaser 4.2.1 has no focus manager. Focus is a field in your UI model (an id), drawn by one reused ring object and
  moved, not recreated, so the object count is constant ([pixel UI input and controls](pixel-ui-input-and-controls.md), 6 and 7).
- [tested] `nextFocus(items, currentId, direction, { wrap, group })` moves to the nearest item strictly ahead along the pressed
  axis, charging cross-axis drift at twice the distance; it wraps within the same row or column, ignores disabled items, stays
  inside a `group` (pass the modal's group so focus cannot leave it), and enters at the first item in reading order when nothing
  is focused. A vertical list does not move on Left or Right.

```ts
import { nextFocus, unreachable } from './spatial-focus.mjs';

const items = controls.map((c) => ({ id: c.id, rect: c.hitRect, enabled: c.enabled, group: c.modal ? 'modal' : 'screen' }));
focusId = nextFocus(items, focusId, 'right', { group: modalOpen ? 'modal' : 'screen' });
// layout test, run at every supported size: no control may be unreachable from the entry item
expect(unreachable(items, nextFocus(items, null, 'down', { group: 'screen' }), { group: 'screen' })).toEqual([]);
```

- [tested] `unreachable(items, startId)` walks all four directions breadth first and lists enabled items that no key sequence
  reaches; two controls with the same centre are the usual cause. Keep the screen's rectangles in the same data the layout
  produced, so the test sees what the player sees.
- [general] Hover and focus are two inputs on one cursor. Move focus on a pointer move that changes the hovered control, not on every
  `pointerover`, and never when the menu opened under a stationary pointer; otherwise the mouse steals focus from a player on the
  keyboard. Track the last device used and hide the ring for the mouse ([gamepad and input](../../phaser-input/references/gamepad-and-input.md)).
- [general] On open, focus the first enabled control (or the primary action of a confirmation); on close, return focus to the control that
  opened it. A modal contains focus in its group and blocks the layer below in both the Phaser and the semantic projection.
- [general] Activation (Enter, Space, pad south, click) calls one handler; Escape or pad east calls `back`. Scroll the focused row into
  view before drawing the ring ([clipped scrolling](pixel-ui-clipped-scrolling.md)).

## Resize, scale and density

- [documented] Pointer coordinates reach interactive objects through the camera that hit tested them, so a UI camera at zoom `S`
  needs no manual division; code that tests rectangles by hand must use `pointer.positionToCamera(uiCamera)`
  (`src/input/Pointer.js`), not `pointer.x`.
- [tested] The scale manager refreshes its canvas bounds on a 500 ms poll; after page chrome appears call `game.scale.updateBounds()`,
  then re-run the layout from the `RESIZE` handler and remove that handler on `SHUTDOWN`
  ([scale and responsive](../../engine-phaser/references/scale-and-responsive.md)).
- [general] Test the matrix: the smallest and largest supported widths, one odd and one even width, two device pixel ratios and
  a 4:3 and a 21:9 aspect. For each, assert no overlap, everything inside the safe area, every target at least the minimum, text
  fits ([text and panels](pixel-perfect-text-and-panels.md), 5) and no control is unreachable.

## Links

[text and bitmap fonts](text-and-bitmap-fonts.md), [DOM overlays and forms](dom-overlays-and-forms.md), [footprint](pixel-perfect-footprint.md).
