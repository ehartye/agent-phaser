# Touch, tap to move and mobile in a Phaser 4 game

Everything here comes from giving Fallow Valley (Phaser 4.2.1, a pixel-only strict-UI game with a headless deterministic sim) a complete
touch scheme: tap to move, gestures, an on-screen button cluster, a joystick and d-pad option, left-handed layout, safe areas, an
installable manifest and a phone render-quality tier. The design is `docs/MOBILE.md` in that repo; the code is `src/sim/pathfind.ts`,
`src/game/input/touch.ts`, `tapIntent.ts`, `InputController.ts` and `src/game/ui/TouchControls.ts`. Tested in Chromium with touch emulation
only: no physical device, no real iOS Safari. Treat the iOS lines as unverified.

## What Phaser 4.2.1 does with fingers

- **It listens to touch events, not pointer events** (`input/touch/TouchManager.js`, `InputManager.onTouchStart`). A touch becomes a
  `Pointer` with `wasTouch === true` and its own `id`; the mouse is pointer 0. Phaser calls `preventDefault` on touch events by default
  (`input: { touch: { capture: true } }`), which is what stops the browser's emulated mouse events after a tap. A touch screen on a
  laptop can still deliver mouse events, so device switching needs a guard (see below).
- **Only one finger by default.** `inputActivePointers` is 1: the mouse plus one touch pointer. Set `input: { activePointers: 3 }` in the game
  config (or `input.addPointer(n)` once) before any two-thumb design works. Each scene's input plugin shares the manager's pointers.
- **`stopPropagation` stops only inside one scene.** Two scenes in parallel (world below, interface above) each get `POINTER_DOWN`; the
  interface scene is processed first, and an interactive object there does not hide the event from the world scene. The world needs a
  flag the interface sets while handling the same down (`pointerOnUi`), and a gesture that resolves on *release* must record who owned the
  finger at *down* time, not look at the flag at up time (it has been reset by then). Keep a `Set` of pointer ids that began on the interface.
- **`pointerover` fires on touch down and `pointerout` on touch up.** Hover-driven UI (a list that selects on hover, a tooltip) turns into
  "select on touch" for free, and any affordance that exists only on hover is invisible to a finger. Activate on `pointerup`, not
  `pointerdown`, for anything a finger might start dragging from (a scrolling list), and keep the mouse's press-to-activate.
- **Pointer coordinates are canvas pixels.** With the usual pixel-exact trick (canvas sized to the page times the device pixel ratio, scale
  manager zoom set to its inverse) divide by `scale.width / scale.displaySize.width` to get CSS pixels. Compute every touch distance
  (slop, long-press drift, edge strip, stick radius) in CSS pixels and multiply by that factor, so a finger feels the same on 1x and 3x.
- **A cancelled touch may not emit `POINTER_UP`.** Poll `pointer.isDown` for the ids you track and cancel any that went up silently.
- **A touch outside the canvas still ends on it**: the touch events target the element the touch began on, so no "up outside" handling is
  needed for touch (the mouse needs `POINTER_UP_OUTSIDE`).

## Design rules that held up

- **Make the finger a gesture recognizer with no Phaser in it** (down, move, up, `update(now)`; events: tap, long, drag start/move/end,
  two-finger tap; time is an argument). It is a few dozen lines and every rule (slop, tap time, long-press, third finger ignored, two-finger
  quickness) is unit-tested on a fake clock. The glue only feeds it and acts on its events.
- **One sim command for "go there": `goto {x, y, then}`.** Taps do not move the player from the view; the view dispatches a command and
  the sim walks. This keeps determinism, replay and saves intact, makes keyboard and pad untouched (any manual move cancels it), and makes
  the behaviour testable headless. See the pathfinding rules below.
- **Bare ground is never worked by a tap.** The one rule that makes touch safe: a tap walks unless the tile has something to *do* (a ripe
  crop, a seed with tilled soil, a creature, a prop, a door, water with a rod or canteen, clearable cover). A long-press is the deliberate
  "use it anyway". Keep the table as a pure function of the sim and test it line by line. The mouse can keep its older "click works the tile in
  reach" because it has hover to preview and a cursor to aim.
- **A finger is about a tile wide.** Count a creature within a tile of the touch as touched and let hostile ones win ties.
- **Hit-test your own buttons by pointer id**, in the interface scene's `POINTER_DOWN/MOVE/UP`, rather than with interactive objects, when
  several fingers can hold several buttons at once, a finger that slides off should not fire, and the world must be told the touch was the
  interface's. Fire on release inside the box; fire movement (d-pad, steppers) on down and hold.
- **Floating stick, not fixed**: anchor where the thumb lands (clamped so the whole stick is on screen), analog magnitude from the distance
  past a dead zone, only on the movement half of the screen. Give tap to move as the default and the stick as a setting; players differ.
- **Layout is a pure function** of the logical size, the touch target size, the safe-area insets, the handedness, the style and the HUD's
  own pieces (hotbar box, status block). Test it over every device class and orientation: inside the safe area, no overlaps, nothing over
  the HUD, every button at least the target size. The tests found real overlaps (a left-handed column under the status block, the more-grid
  over the hotbar in landscape) that a screenshot would have shown only on some sizes.
- **Convert 44 CSS pixels to logical pixels** with the integer UI scale and the pixel ratio: `ceil(44 * canvasPerCss / scale)`. In a
  pixel-only UI a "pixel" is the logical pixel; thinking in CSS pixels is what keeps buttons usable.
- **Text and key hints must change with the device.** Keycaps and glyphs name things the finger cannot press: on touch show the button label
  ("USE") or nothing, and keep a test that every touch button's action exists in the keyboard and pad tables, so there is still one binding
  table.
- **Device switching is by last use**, with the emulated-mouse guard: ignore a "mouse move" within about 500 ms of a touch. Start on touch
  when `matchMedia('(pointer: coarse)')` matches.

## Pathfinding for tap to move (in the sim)

- **Incremental A\*** with a node budget per tick and a chunk-generation budget per tick, so a tap across ungenerated country costs a bounded
  amount of work each frame. The search yields when the terrain next to the node it wants to expand is not generated yet and the tick's
  generation budget is spent; it resumes next tick. Same grid and same goal give the same path whatever the budget (tested with budgets
  1, 3 and 17).
- **Deterministic by construction**: fixed neighbour order, heap ties broken by insertion order, no `Map` iteration in the decision.
- **Diagonals only when both tiles they cut across are open**, so a 0.3 radius body never clips a corner; then pull the path taut with a
  swept test of the body's four corners.
- **Unreachable goals are normal**: a solid tile, a walled-in tile, water. Search "within 1.5 tiles of it" for a solid goal, and when the
  open set is exhausted or the node cap is hit, settle for the explored tile closest to the goal. Do not then act on the target.
- **Following uses the same movement code as the keyboard** (same speed, weight and gear scaling, same collision); shorten the last step
  so it lands on the waypoint. Detect "stuck" by distance moved per tick, replan once, then give up with a denial.
- **Cancel on anything that is a decision**: any non-zero move, a swing, a world command, being hurt, a level change, a new goto. Cancel
  on hurt matters most: a walk that keeps going while something bites you is the way a mobile game kills its player.
- **Arrival actions** (`then: 'use' | 'attack'`) walk within reach of the target and run the same function the keyboard's use runs. An
  attack walk follows the creature (it moves) and swings the moment it is in reach.
- **Hatches and ladders are doors to another level**: never walk over them in passing.

## The page: stop the browser's own gestures

`touch-action: none`, `overscroll-behavior: none`, `user-select: none`, `-webkit-touch-callout: none` and
`-webkit-tap-highlight-color: transparent` on `html`, `body` and the canvas; cancel `contextmenu` (a long-press opens it) and, for iOS
Safari, which ignores `user-scalable=no`, `gesturestart`, `gesturechange` and `gestureend`; `maximum-scale=1`;
`viewport-fit=cover`; `100dvh` after a `100%` fallback (iOS's `100vh` includes the collapsed address bar). A pixel game has its own integer
scale option: that, not pinch, is the zoom.

## Safe areas without a DOM node

`env(safe-area-inset-*)` is only readable through CSS. Register four `<length>` custom properties (`@property --safe-top { syntax:
'<length>'; inherits: true; initial-value: 0px }`) set to `env(...)` on `:root`; `getComputedStyle(document.documentElement)
.getPropertyValue('--safe-top')` then returns a plain pixel length. A strict pixel-only game that bans extra DOM can still avoid the
notch. Needs `@property` (Chrome 85, Safari 16.4); older engines read zero. Cache the read for a fraction of a second.

## Render quality on phones: keep the ratio a whole number

Capping the canvas pixel ratio is the usual phone-performance lever, and with pixel art it is a trap. A first version capped a 3x phone at
2x; the pixel-grid test (every `scale x scale` block of one colour) failed at once because a canvas pixel was then 1.5 device pixels. Divide
the device ratio by a **whole number** instead (3x: 1.0 with 3x3 device blocks; 4x: 2.0), and know that the UI scale (an integer chosen from
the canvas width) then changes too: dividing a 3x phone's ratio by 2 would shrink the interface to two thirds. Keep the tier that divides by
the ratio's whole part (the interface keeps its CSS size, the pixels get chunkier), and skip steps that change nothing. Drive it from a
setting plus a frame-time governor (windows of N frames, strikes, ignore hitches over 250 ms) and halve the weather particles in the lowest
tier. Pure functions, unit-tested. Numbers that worked: the governor steps down after two consecutive windows of 90 frames averaging over 26 ms
(once more on screens 3.5x or denser), at most twice; expose Full, Light and Auto as a setting; Light divides the ratio by its whole part and
halves weather particles.

## Accidental input, haptics and install

- Ignore touches within about 8 CSS px of the left, right and bottom edges: the OS uses them for back and home gestures. A finger that slides
  off a button must not fire it (aim buttons are the exception). Lists activate on release for touch and on press for a mouse; a narrow tablet
  needs a minimum left offset for the hotbar. Show first-touch tips once and remember that in storage.
- Haptics: `navigator.vibrate` with durations per event and a Vibration setting; absent on iOS Safari, so it must be optional and silent.
- Install as an app: a manifest, icons and a theme colour are enough on both platforms (no service worker, so players never see a stale
  build). Maskable icon art stays inside the 80% safe zone; `apple-touch-icon` has no alpha channel (iOS fills transparency with black);
  redraw favicons at their own sizes rather than downscaling; `og:image` needs an absolute URL. Render icons with whole-number scales only and
  keep a `--check` test that re-renders and compares pixels.

## Testing touch with Playwright

- **Emulation is Chromium's**: a device descriptor gives viewport, `deviceScaleFactor`, `isMobile`, `hasTouch` and a user agent, but its
  `defaultBrowserType` is `webkit` and Playwright refuses `test.use({ browserName })` inside a `describe`. Strip `defaultBrowserType`, set
  `browserName: 'chromium'`, and call `test.use` at the top level of a spec file: one thin file per device, all registering one shared suite
  function. Firefox cannot emulate `isMobile`.
- **`page.touchscreen.tap` is a touchstart and touchend back to back.** In a manual-frame harness both are processed in the same frame; that is
  enough for taps. For a held finger (long-press, drag, joystick, aiming) use a CDP session: `Input.dispatchTouchEvent` with `touchStart`,
  `touchMove` and `touchEnd`.
- **Gesture time is the real clock** (`performance.now()`), even when the sim is stepped manually: a long-press test waits in real time (650 ms),
  then runs a frame so the tracker's `update` fires it, then lifts.
- **`page.screenshot()` is in device pixels**; the canvas is in canvas pixels. Compare at the right ratio, and run the palette and integer-grid
  check on every new button, the d-pad and the stick with the world camera hidden (so a hard-alpha corner shows black, not terrain).
- **Give tests the interface's geometry** through a read-only debug hook (the buttons' rectangles in canvas pixels, the top screen's tappable
  zones in creation order) so a test taps what a finger would tap without knowing a screen's layout. Convert canvas pixels to CSS pixels
  with `displaySize.width / width` before tapping.
- **A toast sliding in is out of bounds for a frame**: if the harness checks that all text is on screen after each test, run a few frames
  first.
- Prove: a tap walks to the exact tile; a tap in reach works a crop (water, harvest); a tap on a far crop walks then works it; a tap on
  the interface never moves the player; long-press; a second tap redirects; every button; hotbar tap; screens and their rows tappable;
  d-pad and stick styles; left-handed mirror; Off ignores the world; combat (auto-target swing, a tap on a far enemy, a drag-aimed shot); the
  page never scrolls or zooms; the pixels are atlas pixels on the grid; a contact sheet of a whole first day from the title to the harvest.

## Not done, and why it matters

- **Real devices.** Haptics (`navigator.vibrate`: absent on iOS Safari), the address-bar collapse, frame times on a low-end phone and
  `@property` on iOS before 16.4 are unconfirmed.
- **Service worker.** Not needed to install on either platform; an offline cache serves stale builds of a game that ships often.
- **Art.** The buttons, d-pad and stick reuse existing skin frames; a skin extension would give them their own look.
