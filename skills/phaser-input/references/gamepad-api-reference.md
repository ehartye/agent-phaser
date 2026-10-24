# Gamepad API in Phaser 4.2.1: what the classes expose, assume and leave out

The object model and the facts the other gamepad references do not give. Threshold values, glyph choice and the lifecycle
defects are in [gamepad and input](gamepad-and-input.md) and [lifecycle hazards](gamepad-lifecycle-hazards.md). Reproduce the
tested facts with `node examples/web/phaser-probes/phaser-input-gamepad.mjs <project>` (a fake `navigator.getGamepads`, Canvas
renderer, no hardware).

## Object model and polling

| Class | Reached as | Holds |
| --- | --- | --- |
| `GamepadPlugin` | `scene.input.gamepad` (needs `input: { gamepad: true }`) | `gamepads[]` by browser index, `pad1` to `pad4` aliases, `total` |
| `Gamepad` | `plugin.getPad(index)`, `plugin.getAll()` | `buttons[]`, `axes[]`, `leftStick`, `rightStick`, `vibration`, the raw `pad` |
| `Button` | `pad.buttons[i]` | `value`, `pressed`, `threshold` (default 1) |
| `Axis` | `pad.axes[i]` | `value`, `threshold` (default 0.1), `getValue()` |

- [documented] Each scene that has the plugin builds its own `Gamepad` wrappers and calls `navigator.getGamepads()` itself, so
  thresholds set on one scene's `Button` objects do not reach another scene's (`src/input/gamepad/GamepadPlugin.js#refreshPads`).
  Use one owner scene ([input architecture](input-architecture.md)).
- [tested] The refresh runs in `InputManager#preRender`, after the scene update of the same frame: the observed order was
  `POST_STEP`, `pad.update`, `PRE_RENDER`. A read in `update` returns the previous frame's sample.
- [documented] The plugin is created only when `input.gamepad` is true in the game or scene config, so with the default `false`
  `scene.input.gamepad` is undefined and any call on it throws; it also stays disabled when the browser lacks the API
  (`game.device.input.gamepads`).

## Reading values

- [documented] The named properties are fixed to the standard-mapping indices: `A` is `buttons[0]`, `B` 1, `X` 2, `Y` 3, `L1` 4,
  `R1` 5, `L2` 6, `R2` 7, `up` 12, `down` 13, `left` 14, `right` 15 (`src/input/gamepad/Gamepad.js` constructor). Start, back,
  stick presses and home (8 to 11 and 16) have no property: read `pad.buttons[9].pressed` and name the constants yourself.
- [tested] `A` returned a boolean and `R2` the analog value. At the default threshold of 1 a trigger at 0.6 reads 0.6, is not
  pressed and fires no `down`.
- [documented] `A`, `B`, `X`, `Y` and the d-pad getters return `pressed`; `L1`, `L2`, `R1` and `R2` return `value` (same file).
- [tested] The stick reads through the axis threshold per component: a raw `(0.08, 0.5)` became `leftStick (0, 0.5)`. Raw samples
  stay on `pad.axes[i].value`.
- [documented] `leftStick` is written only when the pad has two axes and `rightStick` only with four; otherwise they stay at zero.
- [documented] The `Phaser.Input.Gamepad.Configs` objects (Xbox 360, DualShock 4, SNES) are plain index tables that nothing in
  the engine reads. Do not expect a pad to be remapped through them.

## Mapping and non-standard pads

- [tested] A pad that reports `mapping: ''` is read through the same indices: its button 0 became `A` and its button 2 became `X`.
  Phaser never looks at `mapping`, so the names are right only for `'standard'` devices.
- [general] Check `pad.pad.mapping === 'standard'` when a pad connects. For anything else show a rebinding step that records the
  first button index or axis the player moves, store it by `Gamepad.id`, and read `pad.buttons[i]` and `pad.axes[i]` directly. A hat
  switch reported as an axis on such devices has no named property.
- [general] Name inputs by position (`south`, `east`, `west`, `north` for 0 to 3) in your action table and pick the glyph from the
  vendor ids in `Gamepad.id`; see [gamepad and input](gamepad-and-input.md).

## Events

- [tested] Plugin events are `down` and `up` with `(pad, button, value)`; pad events are `down` and `up` with
  `(index, value, button)`; `connected` and `disconnected` carry `(pad, event)` on the plugin. The constants are
  `Phaser.Input.Gamepad.Events.BUTTON_DOWN`, `BUTTON_UP`, `GAMEPAD_BUTTON_DOWN`, `GAMEPAD_BUTTON_UP`, `CONNECTED`, `DISCONNECTED`
  (`'down'`, `'up'`, `'down'`, `'up'`, `'connected'`, `'disconnected'`).
- [documented] `down` fires when `value >= threshold` and the button was not pressed; `up` fires when it falls below. There is no
  repeat event and no axis event: derive repeats and stick edges in the owner.
- [documented] `connected` and `disconnected` are queued by the DOM handler and delivered on the next input update, not inside the
  browser event, so a handler may see the pad already updated by one more poll.

## Haptics and access

- [documented] `pad.vibration` is the browser's `vibrationActuator` captured when the wrapper was built and is `undefined` or
  `null` where the browser has none. Feature-detect it and wrap `playEffect('dual-rumble', { duration, weakMagnitude,
  strongMagnitude })` in a try/catch, because the promise can reject.
- [general] Browsers expose a pad only after a button press or stick movement while the page is focused and, in most browsers, on
  a secure context; a pad that is plugged in but untouched is absent from `getAll()`. Show "press any button" rather than "no
  controller".

## Verify

- [tested] The fake pad in `phaser-input-gamepad.mjs` returns fresh snapshots per call, `null` for empty slots, and dispatches the
  connect event; copy it for suites that drive the real plugin.
- [general] Synthetic samples prove Phaser's mapping and your action table. They do not prove a physical device's `id`,
  calibration, reported mapping or vibration; leave those to a hands-on playtest and say so.

## Links

[gamepad and input](gamepad-and-input.md), [gamepad lifecycle hazards](gamepad-lifecycle-hazards.md), [keyboard](keyboard.md).
