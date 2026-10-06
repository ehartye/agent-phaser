# Controllers and input devices in a Phaser 4 game

Everything here comes from adding first-class gamepad support to Fallow Valley (Phaser 4.2.1, Chrome on Windows with a mocked
pad). The code lives in that repo under `src/game/input` and `docs/INPUT.md`; read those for the full design.

## Do not build on Phaser's Gamepad plugin

Read from `node_modules/phaser/src/input/gamepad` and confirmed in the browser with Phaser's own `Gamepad`, `Button` and `Axis`
classes fed a fake pad:

- **Off by default.** `input: { gamepad: true }` in the game config; otherwise `scene.input.gamepad` is undefined.
- **`Button.threshold` is 1.** `pressed` needs 1.0, so an analog trigger at 90% travel is not pressed and many pads never report
  exactly 1.0. Use `button.value` and your own threshold (0.5).
- **`Axis.threshold` is 0.1 and per axis.** `leftStick` zeroes each axis on its own: `(0.12, 0.05)` reads `(0.12, 0)`, bending the
  direction onto an axis. A dead zone belongs on the vector's length.
- **`Gamepad.connected` and `.timestamp` are creation-time snapshots.** `update(pad)` copies buttons and axes but never replaces
  `this.pad`, and browsers hand back a new snapshot per `getGamepads()` call, so `connected` is `true` forever. Disconnects are
  visible only through the `DISCONNECTED` event.
- **Dead pads stay.** `plugin.gamepads` is sparse by device index and never pruned, `total` is its `length`, `pad1` to `pad4` are
  never cleared (a pad re-plugged at another index leaves `pad1` stale).
- **Stale-timestamp early return.** `Gamepad.update` returns when `pad.timestamp < this._created`. Chrome only advances the
  timestamp when state changes, so a pad that has not changed since the object was created is ignored until it does. A fake pad
  with `timestamp: 0` never updates.
- **One plugin per scene.** Each scene owns its plugin, its `Gamepad` objects and its own button state, so three scenes see three
  independent sets of edges.

## What to do instead

Poll `navigator.getGamepads()` yourself, once per frame, in a plain class with no Phaser import:

- Hook `game.events.on(Phaser.Core.Events.PRE_STEP, ...)` so every scene reads one frame and the same button edges.
- Apply a **radial** dead zone (length based, about 0.2 for movement), ramp from the dead zone to about 0.95 (worn sticks never reach
  1.0) so there is no jump at the edge, optionally raise to a power of 1.2 to 1.3 for fine control. Treat NaN as zero.
- Triggers are buttons with an analog `value`: press at 0.5.
- Compute edges per pad from the previous poll. With several pads, the one with the latest activity is active.
- A pad unplugged mid-game appears as a null slot or `connected: false`: release everything (the player must stop) and fall back to
  keyboard hints.
- The browser exposes a pad only after a button press on it while the page is focused, and `getGamepads()` needs a secure context
  (https or localhost). Wrap the call in try/catch.
- Haptics: `pad.vibrationActuator?.playEffect('dual-rumble', { duration, weakMagnitude, strongMagnitude })` exists in Chrome-family
  browsers only. Swallow rejections and treat it as optional.

## Design that paid off

- **Name buttons by position** (`south`, `east`, `west`, `north`) and pick the glyph from the controller family detected in
  `Gamepad.id` (Xbox, PlayStation, Switch, Steam Deck). Nintendo labels A and B opposite to Xbox, so a hint that says "A" is wrong
  on a Switch pad; position names avoid it. Vendor ids in the id string (045e, 054c, 057e, 28de) are the reliable match.
- **One binding table in data**, with a validator and a partial override from storage, and a controls screen generated from that same
  table so the help can never drift.
- **Turn the pad into the keys your screens already handle** (arrows, Enter, Escape, Tab, page keys) with a small repeat-aware
  navigator, and let a screen override a button. Every keyboard-complete screen is then pad-complete with no per-screen code, and
  hint rows resolve a keyboard-named hint through the screen's overrides to a glyph, dropping hints the pad cannot do (test that none
  silently vanishes).
- **A cursor tile instead of a pointer** for tile games: the tile the player faces, steered and held by the right stick, clamped to
  the sim's reach, drawn from the art kit; carry the aim point in attack commands so the mouse and the pad share them.
- **Track the last device used** (button edge or stick past its dead zone means pad; key, mouse move or click, or pad loss means
  keyboard) and rebuild every glyph on a change. Drift inside the dead zone is not input.
- **Pause stops the sim** through a flag the world scene reads; modal capture swallows pad edges for a few frames after a screen
  closes so the press that closed it does not also act.
- **Name entry** needs an on-screen keyboard: a grid of skin buttons with spatial focus (nearest in a direction, drift across the axis
  counts double, wraps) kept as pure functions so they unit-test.

## Verifying without hardware

Replace `navigator.getGamepads` in `page.addInitScript` with a function that returns a fresh snapshot of a fake pad (axes, buttons
with analog values, `timestamp: performance.now()`, a recording `vibrationActuator`) and nothing until a `connect()`; drive it from
the test, then assert on game state (sim commands, cursor tile, open modal) and measure pixels as usual.

- Never return a Phaser object from `page.evaluate` (`camera.setVisible(false)` returns the camera): serialising its object graph
  blows the test runner's heap with an out-of-memory crash. Use a block body.
- Mutation-test the pure parts (dead zone, focus movement, repeat timing) with a script that rewrites one line, runs the unit tests and
  requires failure.
- Synthetic input proves the mapping end to end. It does not prove a physical device's `id`, calibration, reported mapping or
  vibration; say so and leave that to a playtest.
