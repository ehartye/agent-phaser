# Touch in a Phaser 4 game: what the engine does and the design rules

Index: [touch-and-mobile.md](touch-and-mobile.md).

## What Phaser 4.2.1 does with fingers

- [general] **It listens to touch events, not pointer events** (`input/touch/TouchManager.js`, `InputManager.onTouchStart`). A touch becomes a
  `Pointer` with `wasTouch === true` and its own `id`; the mouse is pointer 0. Phaser calls `preventDefault` on touch events by default
  (`input: { touch: { capture: true } }`), which is what stops the browser's emulated mouse events after a tap. A touch screen on a
  laptop can still deliver mouse events, so device switching needs a guard (see below).
- [general] **Only one finger by default.** `inputActivePointers` is 1: the mouse plus one touch pointer. Set `input: { activePointers: 3 }` in the game
  config (or `input.addPointer(n)` once) before any two-thumb design works. Each scene's input plugin shares the manager's pointers.
- [tested] **Who hears a press depends on `globalTopOnly`, not on `stopPropagation`.** Two scenes in parallel (world below, interface above) are
  processed top first. With the default `globalTopOnly` an interactive object under the finger in the interface scene hides the down from the
  world completely; an interface that hit-tests its own buttons by pointer id (no Phaser interactive object, as below) hides nothing, so the world
  needs a flag the interface sets while handling the same down (`pointerOnUi`) or a `this.input.stopPropagation()` in the interface's scene-level
  handler, and that call hides the down but not the later up. A gesture that resolves on *release* must record who owned the finger at *down*
  time, not look at the flag at up time (it has been reset by then). Keep a `Set` of pointer ids that began on the interface. Probe and details:
  [pointer and mouse](pointer-and-mouse.md).
- [general] **`pointerover` fires on touch down and `pointerout` on touch up.** Hover-driven UI (a list that selects on hover, a tooltip) turns into
  "select on touch" for free, and any affordance that exists only on hover is invisible to a finger. Activate on `pointerup`, not
  `pointerdown`, for anything a finger might start dragging from (a scrolling list), and keep the mouse's press-to-activate.
- [general] **Pointer coordinates are canvas pixels.** With the usual pixel-exact trick (canvas sized to the page times the device pixel ratio, scale
  manager zoom set to its inverse) divide by `scale.width / scale.displaySize.width` to get CSS pixels. Compute every touch distance
  (slop, long-press drift, edge strip, stick radius) in CSS pixels and multiply by that factor, so a finger feels the same on 1x and 3x.
- [general] **A cancelled touch may not emit `POINTER_UP`.** Poll `pointer.isDown` for the ids you track and cancel any that went up silently.
- [general] **A touch outside the canvas still ends on it**: the touch events target the element the touch began on, so no "up outside" handling is
  needed for touch (the mouse needs `POINTER_UP_OUTSIDE`).

## Design rules that held up

- [general] **Make the finger a gesture recognizer with no Phaser in it** (down, move, up, `update(now)`; events: tap, long, drag start/move/end,
  two-finger tap; time is an argument). It is a few dozen lines and every rule (slop, tap time, long-press, third finger ignored, two-finger
  quickness) is unit-tested on a fake clock. The glue only feeds it and acts on its events.
- [general] **One sim command for "go there": `goto {x, y, then}`.** Taps do not move the player from the view; the view dispatches a command and
  the sim walks. This keeps determinism, replay and saves intact, makes keyboard and pad untouched (any manual move cancels it), and makes
  the behaviour testable headless. See the pathfinding rules below.
- [general] **Bare ground is never worked by a tap.** The one rule that makes touch safe: a tap walks unless the tile has something to *do* (a ripe
  crop, a seed with tilled soil, a creature, a prop, a door, water with a rod or canteen, clearable cover). A long-press is the deliberate
  "use it anyway". Keep the table as a pure function of the sim and test it line by line. The mouse can keep its older "click works the tile in
  reach" because it has hover to preview and a cursor to aim.
- [general] **A finger is about a tile wide.** Count a creature within a tile of the touch as touched and let hostile ones win ties.
- [general] **Hit-test your own buttons by pointer id**, in the interface scene's `POINTER_DOWN/MOVE/UP`, rather than with interactive objects, when
  several fingers can hold several buttons at once, a finger that slides off should not fire, and the world must be told the touch was the
  interface's. Fire on release inside the box; fire movement (d-pad, steppers) on down and hold.
- [general] **Floating stick, not fixed**: anchor where the thumb lands (clamped so the whole stick is on screen), analog magnitude from the distance
  past a dead zone, only on the movement half of the screen. Give tap to move as the default and the stick as a setting; players differ.
- [general] **Layout is a pure function** of the logical size, the touch target size, the safe-area insets, the handedness, the style and the HUD's
  own pieces (hotbar box, status block). Test it over every device class and orientation: inside the safe area, no overlaps, nothing over
  the HUD, every button at least the target size. The tests found real overlaps (a left-handed column under the status block, the more-grid
  over the hotbar in landscape) that a screenshot would have shown only on some sizes.
- [general] **Convert 44 CSS pixels to logical pixels** with the integer UI scale and the pixel ratio: `ceil(44 * canvasPerCss / scale)`. In a
  pixel-only UI a "pixel" is the logical pixel; thinking in CSS pixels is what keeps buttons usable.
- [general] **Text and key hints must change with the device.** Keycaps and glyphs name things the finger cannot press: on touch show the button label
  ("USE") or nothing, and keep a test that every touch button's action exists in the keyboard and pad tables, so there is still one binding
  table.
- [general] **Device switching is by last use**, with the emulated-mouse guard: ignore a "mouse move" within about 500 ms of a touch. Start on touch
  when `matchMedia('(pointer: coarse)')` matches.
