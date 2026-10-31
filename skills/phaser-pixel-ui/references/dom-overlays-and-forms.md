# DOM overlays and forms over a Phaser 4.2.1 canvas

When to put native elements (inputs, buttons, links, long text) over the game, how `DOMElement` places them, and the input
traps that come with it. Reproduce the tested facts with `node examples/web/phaser-probes/phaser-pixel-ui-panels.mjs <project>`
(container, zoom, lifecycle, focus) and `phaser-input-pointer.mjs` (click-through). The semantic-bridge architecture is section 7
of [input and controls](pixel-ui-input-and-controls.md); section 8 documents the bounded desktop AX/input probe and its device/compliance limits. The Phaser skills bundled with 4.2.1 have no DOMElement page.

## DOM or canvas

| Content | Use | Why |
| --- | --- | --- |
| Name entry, search, save-slot names, passwords | native `<input>` | IME, selection, paste, autofill and the soft keyboard come free |
| Long or translated text, legal text, links | DOM | selectable, searchable, assistive technology reads it |
| A button that must be reachable by screen reader | DOM or the semantic bridge | the canvas has no accessibility tree |
| HUD, labels in the world, anything tied to camera effects | canvas objects | DOM cannot sit between canvas objects |
| A pixel-exact menu face | canvas bitmap text and skins | browser text is not on the source-pixel grid |

- [general] Default to the canvas for what the game draws every frame and to DOM for what the player types, selects or must have
  read aloud; mixing the two costs the traps in the third section, so keep the DOM set small and its owner single.

## Two ways to place elements

| | Phaser DOM container (`add.dom`) | Page-level overlay (your own element) |
| --- | --- | --- |
| Follows camera scroll, zoom, scene visibility | yes | no, you reposition it |
| CSS lengths mean | game pixels | CSS pixels |
| Needs | `dom.createContainer` and a `parent` | `getBoundingClientRect()` of the canvas |

- [tested] `dom: { createContainer: true }` without a `parent` creates no container (`game.domContainer` stays `null`) and
  `add.dom` throws "No DOM Container set in game config"; the 4.0.0 changelog lists the throw. Give the game a parent element.
- [documented] The container is an absolutely positioned, `overflow: hidden` div inside the parent, sized to the game's base size
  with `pointer-events: none`; each `DOMElement` sets its own `pointer-events` (`auto` by default), `position: absolute` and a CSS
  matrix built from its transform and the camera (`src/dom/CreateDOMContainer.js`, `src/gameobjects/domelement/`).
- [documented] DOM elements always draw above the canvas. `depth` becomes `style.zIndex` and orders DOM elements only, so an
  element can never sit under a canvas sprite; hide it, or draw that sprite as DOM too.
- [tested] The container is scaled by `displaySize / baseSize`. With `scale: { mode: NONE, zoom: 0.5 }` a 60 by 40 element at
  (20, 10) measured 30 by 20 CSS pixels at (10, 5), and its declared 16 px font was effectively 8 CSS pixels. Under the
  device-pixel policy (`zoom = 1 / dpr`) author sizes as `cssSize * dpr`, or use a page-level overlay for forms so text keeps CSS sizes.
- [tested] Stopping the scene removes its element nodes and starting it again creates them. Do not keep the node in a field across
  scene restarts.
- [documented] A sleeping scene sets its elements to `display: none` and waking restores them (`DOMElement#handleSceneEvent`).

## Traps when a form sits over the canvas

- [tested] Symptom: pressing a DOM button also presses the Phaser object under it. Cause: Phaser listens for `mousedown`, `mouseup`
  and the touch events on `window` as well as on the canvas, and processes events whose target is another element. Fix: on the
  element (or its wrapper) call `event.stopPropagation()` for `mousedown`, `mouseup`, `touchstart`, `touchend` and `touchcancel`;
  the element still receives its own `click`.
- [documented] `input: { windowEvents: false }` removes the window listeners altogether, which also stops `POINTER_UP_OUTSIDE`
  (`src/core/Config.js`).
- [tested] Symptom: typing `wasd` into a field shows ` go`. Cause: `addKey` and `addKeys` capture their keys globally and the
  capture outlives the scene, and key events from a focused field reach every keyboard scene. Fix: `clearCaptures()` or
  `disableGlobalCapture()` while a field has focus, and gate gameplay actions on a `text-entry` context
  ([keyboard](../../phaser-input/references/keyboard.md), [input architecture](../../phaser-input/references/input-architecture.md)).
- [tested] Symptom: clicking the canvas leaves the cursor in the field. Cause: the canvas prevents the default of `mousedown`, which
  is what moves browser focus. Fix: set `input.mouse.preventDefaultDown: false`
  (the click then blurred the field), or call `field.blur()` yourself in a `pointerdown` handler.
- [tested] Symptom: after a layout change around the canvas the first presses land offset. Cause: pointer mapping uses cached
  canvas bounds refreshed every 500 ms; call `game.scale.updateBounds()` after showing or hiding page chrome.
- [general] Move focus into a field from a real user gesture (`pointerup` handler calling `field.focus()`), or the mobile soft keyboard
  does not open. Keep the field in the layout viewport and listen to `visualViewport` resize if the soft keyboard covers it; none of
  this is verifiable in desktop Chromium, so test on a device and say so.

## Verify

- [general] Query the DOM directly (`getByRole`, `inputValue`, `document.activeElement`) instead of through the canvas, and assert two
  things after each press: the DOM control reacted once, and no Phaser object under it did.
- [general] Count nodes in `game.domContainer` (or the overlay root) across ten scene restarts; the count must return to its start.

## Links

[text and bitmap fonts](text-and-bitmap-fonts.md), [pointer and mouse](../../phaser-input/references/pointer-and-mouse.md), [footprint](pixel-perfect-footprint.md).
