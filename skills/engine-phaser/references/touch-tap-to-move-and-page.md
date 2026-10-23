# Touch in a Phaser 4 game: tap to move, the page, phones and tests

Index: [touch-and-mobile.md](touch-and-mobile.md).

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
tier. Pure functions, unit-tested. Numbers that worked in one project (reported, not reproduced here): the governor steps down after two consecutive windows of 90 frames averaging over 26 ms
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
