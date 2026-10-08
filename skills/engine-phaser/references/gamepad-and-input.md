# Controllers and input devices in a Phaser 4 game

The Fallow Valley examples live under `src/game/input` and `docs/INPUT.md`. Their custom polling is a project-specific
implementation, not a requirement for other games. Start with the installed Phaser API and verify the game's requirements.

## Start with Phaser's Gamepad plugin

Enable `input: { gamepad: true }` in the game config. Use one scene as the input owner and project its actions to gameplay and
menus; other scenes must not independently dispatch the same controller actions. Configure each pad when acquired or reconnected:

```ts
// Native configuration, applied before consuming actions from this pad.
for (const button of pad.buttons) button.threshold = 0.5;
pad.setAxisThreshold(0);
// Read pad.leftStick (or axes values); apply one radial response in the action mapper.
```

- `Button.threshold` defaults to 1; setting it to 0.5 retains Phaser's pressed state and button edge events. A configurable
  default is not a reason to replace the plugin or maintain a second edge detector.
- Axis thresholds default to 0.1 per component. Setting them to zero preserves the vector `(0.12, 0.05)` instead of `(0.12, 0)`.
  Apply one game-specific radial dead zone to the vector: about 0.2 for movement, rescaled toward full speed around 0.95 if desired.
  Treat non-finite values as zero. Do not stack per-axis clipping with a radial transform.
- Use `CONNECTED` and `DISCONNECTED` events to maintain active device identity and release held actions on loss. Clear gameplay
  actions on blur, hidden, modal capture and scene shutdown too. Unsubscribe on shutdown; resample or reacquire on resume.
- Read native button state and edges in the owner's Phaser input/update cycle. Share the resulting action state, bindings and
  focus policy; do not add a second `navigator.getGamepads()` loop beside the native plugin.

## Version-scoped lifecycle hazards and fallback gate

Verified against installed Phaser **4.2.1** source (`src/input/gamepad/{Button,Axis,Gamepad,GamepadPlugin}.js`) and synthetic
fresh snapshots in Chrome on Windows, 2026-10-06. These are conditions to reproduce in the target game, not claims about all
browsers or later Phaser versions:

- `Gamepad.update(pad)` updates controls but retains its original `this.pad`. With fresh snapshots, `.connected` and `.timestamp`
  can be stale. Prefer lifecycle events to those cached properties for device loss.
- `refreshPads()` skips null slots without pruning cached pads; `total` is the sparse array length, and `pad1` to `pad4` can
  retain stale aliases. Track event-based membership by device index; do not infer active membership from aliases or `total`.
- `update` ignores snapshots whose timestamp is earlier than `_created`. The trial reproduced ignored controls at timestamp 0.
  Test held input on initial acquisition and resume, including a valid older unchanged timestamp; do not merely make a mock's
  timestamp advance every frame and declare lifecycle parity.
- Scene plugins have independent control state. One action owner prevents duplicate dispatch; test its shutdown/restart and
  controller reconnection, including reuse of an index by the same or a different device.

Before replacing an engine capability, record the requirement, installed version, native API/configuration attempted, failing
minimal reproduction and smallest workaround. Prefer a scoped lifecycle adapter or upstream fix over replacing the entire input
stack. If direct polling is demonstrated necessary, use it as the **single** controller source, disable competing native controller
consumption, and record a regression test plus removal condition. Do not patch Phaser private fields merely to make a test pass.

The 2026-10-06 trial exercised native classes and plugin methods with synthetic inputs, not physical controllers or a full scene
lifecycle. The configurable thresholds passed; the caching and timestamp defects above remain. The correction below has separate
native Scene lifecycle evidence. Neither trial certifies Phaser 4.2.1 as free of controller bugs.

Gamepad exposure can require a focused user gesture and a secure context (https or localhost). Test denied/unavailable access.
Haptics are optional: feature-detect the actuator and swallow unsupported/rejected effects.

### Tested queued lifecycle correction (4.2.1 only)

[tested] On 2026-10-07, a standalone 32×32 WebGL Scene with synthetic browser-pad snapshots reproduced native events
`down → disconnected → connected` when a neutral pad disconnected and reconnected held at the same id/index. The DOM handler
calls `refreshPads()` before queueing the event; the native frame update refreshes again before publishing the queue. A connection
callback cannot capture that earlier edge. No application controller, audio or game host was involved.

For that exact-version defect, copy [phaser-gamepad-lifecycle-patch.mjs](../scripts/assets/phaser-gamepad-lifecycle-patch.mjs)
into the project's `scripts/` and run it after installation, before the bundler optimizes Phaser:

```sh
node scripts/phaser-gamepad-lifecycle-patch.mjs node_modules/phaser
```

Recreate any existing optimized dependency cache afterward. The helper requires exactly `phaser@4.2.1`, preflights the native
source plus unminified ESM/CJS bundles before writing, rejects unknown/ambiguous/mixed fragments, and is idempotent. It preserves
outside bytes, LF/CRLF and independent audio/held-timestamp corrections. It is a temporary dependency correction, not a runtime
input adapter: the DOM handler queues lifecycle only; native acquisition prepares a usable pad from each connected event without
polling or control updates; FIFO lifecycle callbacks run before one ordinary native refresh. Native `Button` still owns pressed
state, thresholds and transition edges. Native shutdown clears the stopped Scene's pending lifecycle queue before restart.

Configure thresholds in `CONNECTED`, and capture held controls from its second argument's `event.gamepad.buttons` using each
configured threshold. A newly constructed Button seeds `pressed` but starts `value` at zero; a reused wrapper can still be neutral
until the subsequent refresh. Keep held actions captured through the native down, release capture on native up, then accept a fresh
down once. Apply the same acquisition policy to already exposed pads. Ordinary analog thresholds alone need only public native
configuration, not this correction.

[tested] The correction produced `disconnected → connected → down` with a matching raw/native connection identity and capture
before the held edge; neutral release and a fresh analog press activated once. Native source tests cover initial held acquisition,
older unchanged timestamps with the independent held-input correction, same/different id and index, and ten listener shutdown/restart
cycles. The isolated Chromium 153 / Playwright 1.63.0 run passed on an NVIDIA RTX 5070 Ti Laptop GPU through D3D11, including initial
held analog acquisition, different-id replacement, ten actual Scene restarts and native destruction/listener cleanup. A separately
reproduced pending-event stop/start retained two events and replayed both callbacks; clearing the native queue on shutdown prevented
that replay while a later native connection event still fired once. Served optimized
bytes were tied to the corrected consumed ESM through the actual source map. These are synthetic-input results, not physical-controller
certification; sparse cached membership/aliases and the independent timestamp gate remain outside this helper.

Remove the helper after upgrading to an upstream version verified without it: usable FIFO connection capture must precede held edges,
neutral release must permit exactly one fresh press, and Scene shutdown/restarts must retire queued events and keep native listeners bounded. A version change
alone is not the removal test.

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
- **Spatial focus rule**: Up and Down go to something higher or lower on screen, Left and Right to something left or right, and nothing
  else; never lay out two columns while the keys walk a list. Measure it by testing the rectangles a screen reports at several window
  sizes. A cycle ring (tools, weapons) is ordered by what an item is, not where it sits: equipping swaps slots, and a slot-ordered ring
  reshuffles so the third item is never reached.
- **Name entry** needs an on-screen keyboard: a grid of skin buttons with spatial focus (nearest in a direction, drift across the axis
  counts double, wraps) kept as pure functions so they unit-test.

## Verifying without hardware

Replace `navigator.getGamepads` in `page.addInitScript` with a function that returns fresh snapshots of a fake pad (axes, analog
button values, controllable timestamps, an optional recording actuator), and nothing until `connect()`. Dispatch matching browser
connect/disconnect events. Drive the real native input owner and assert on game state (commands, cursor, open modal).

- Verify partial triggers, vector direction, drift, one edge per press, two pads, hot unplug while held, reconnection at the same and
  a different index, held input at boot/resume, blur/hidden, modal capture, and ten scene restarts without listener growth.
- Include unavailable API and stale/unchanged timestamps as deliberate cases. A happy-path mock does not establish native lifecycle
  correctness. Scope any fallback to the observed failure and rerun this suite after a Phaser upgrade.

- Never return a Phaser object from `page.evaluate` (`camera.setVisible(false)` returns the camera): serialising its object graph
  blows the test runner's heap with an out-of-memory crash. Use a block body.
- Mutation-test the pure parts (dead zone, focus movement, repeat timing) with a script that rewrites one line, runs the unit tests and
  requires failure.
- Synthetic input proves the mapping end to end. It does not prove a physical device's `id`, calibration, reported mapping or
  vibration; say so and leave that to a playtest.
