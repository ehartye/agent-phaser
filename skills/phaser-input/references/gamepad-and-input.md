# Controllers and input devices in a Phaser 4 game

Custom controller polling is a project-specific choice, not a requirement for most games. Start with the installed Phaser API
and verify the game's requirements.

Moved to their own file:

| Section | File |
|---|---|
| Version-scoped lifecycle hazards and fallback gate | [gamepad-lifecycle-hazards.md](gamepad-lifecycle-hazards.md) |
| Object model, named properties, mapping assumption and events | [gamepad-api-reference.md](gamepad-api-reference.md) |

## Start with Phaser's Gamepad plugin

Enable `input: { gamepad: true }` in the game config. Use one scene as the input owner and project its actions to gameplay and
menus; other scenes must not independently dispatch the same controller actions. Configure each pad when acquired or reconnected:

```ts
// Native configuration, applied before consuming actions from this pad.
for (const button of pad.buttons) button.threshold = 0.5;
pad.setAxisThreshold(0);
// Read pad.leftStick (or axes values); apply one radial response in the action mapper.
```

- [general] `Button.threshold` defaults to 1; setting it to 0.5 retains Phaser's pressed state and button edge events. A configurable
  default is not a reason to replace the plugin or maintain a second edge detector.
- [general] Axis thresholds default to 0.1 per component. Setting them to zero preserves the vector `(0.12, 0.05)` instead of `(0.12, 0)`.
  Apply one game-specific radial dead zone to the vector: about 0.2 for movement, rescaled toward full speed around 0.95 if desired.
  Treat non-finite values as zero. Do not stack per-axis clipping with a radial transform.
- [general] Use `CONNECTED` and `DISCONNECTED` events to maintain active device identity and release held actions on loss. Clear gameplay
  actions on blur, hidden, modal capture and scene shutdown too. Unsubscribe on shutdown; resample or reacquire on resume.
- [general] Read native button state and edges in the owner's Phaser input/update cycle. Share the resulting action state, bindings and
  focus policy; do not add a second `navigator.getGamepads()` loop beside the native plugin.

## Design that paid off

- [general] **Name buttons by position** (`south`, `east`, `west`, `north`) and pick the glyph from the controller family detected in
  `Gamepad.id` (Xbox, PlayStation, Switch, Steam Deck). Nintendo labels A and B opposite to Xbox, so a hint that says "A" is wrong
  on a Switch pad; position names avoid it. Vendor ids in the id string (045e, 054c, 057e, 28de) are the reliable match.
- [general] **One binding table in data**, with a validator and a partial override from storage, and a controls screen generated from that same
  table so the help can never drift.
- [general] **Turn the pad into the keys your screens already handle** (arrows, Enter, Escape, Tab, page keys) with a small repeat-aware
  navigator, and let a screen override a button. Every keyboard-complete screen is then pad-complete with no per-screen code, and
  hint rows resolve a keyboard-named hint through the screen's overrides to a glyph, dropping hints the pad cannot do (test that none
  silently vanishes).
- [general] **A cursor tile instead of a pointer** for tile games: the tile the player faces, steered and held by the right stick, clamped to
  the sim's reach, drawn from the art kit; carry the aim point in attack commands so the mouse and the pad share them.
- [general] **Track the last device used** (button edge or stick past its dead zone means pad; key, mouse move or click, or pad loss means
  keyboard) and rebuild every glyph on a change. Drift inside the dead zone is not input.
- [general] **Pause stops the sim** through a flag the world scene reads; modal capture swallows pad edges for a few frames after a screen
  closes so the press that closed it does not also act.
- [general] **Spatial focus rule**: Up and Down go to something higher or lower on screen, Left and Right to something left or right, and nothing
  else; never lay out two columns while the keys walk a list. Measure it by testing the rectangles a screen reports at several window
  sizes. A cycle ring (tools, weapons) is ordered by what an item is, not where it sits: equipping swaps slots, and a slot-ordered ring
  reshuffles so the third item is never reached.
- [general] **Name entry** needs an on-screen keyboard: a grid of skin buttons with spatial focus (nearest in a direction, drift across the axis
  counts double, wraps) kept as pure functions so they unit-test.

## Verifying without hardware

Replace `navigator.getGamepads` in `page.addInitScript` with a function that returns fresh snapshots of a fake pad (axes, analog
button values, controllable timestamps, an optional recording actuator), and nothing until `connect()`. Dispatch matching browser
connect/disconnect events. Drive the real native input owner and assert on game state (commands, cursor, open modal).

- [general] Verify partial triggers, vector direction, drift, one edge per press, two pads, hot unplug while held, reconnection at the same and
  a different index, held input at boot/resume, blur/hidden, modal capture, and ten scene restarts without listener growth.
- [general] Include unavailable API and stale/unchanged timestamps as deliberate cases. A happy-path mock does not establish native lifecycle
  correctness. Scope any fallback to the observed failure and rerun this suite after a Phaser upgrade.

- [general] Never return a Phaser object from `page.evaluate` (`camera.setVisible(false)` returns the camera): serialising its object graph
  blows the test runner's heap with an out-of-memory crash. Use a block body.
- [general] Mutation-test the pure parts (dead zone, focus movement, repeat timing) with a script that rewrites one line, runs the unit tests and
  requires failure.
- [general] Synthetic input proves the mapping end to end. It does not prove a physical device's `id`, calibration, reported mapping or
  vibration; say so and leave that to a playtest.
