# Input architecture for a Phaser 4.2.1 game: one owner, actions, the fixed step, replay

How to wire keyboard, pointer and gamepad so that every device feeds one action state, scenes cannot double-handle a press, and
tests can replay a session. The device facts are in [keyboard](keyboard.md), [pointer and mouse](pointer-and-mouse.md) and
[gamepad API reference](gamepad-api-reference.md); the fixed-step loop itself is in
[scenes, loop and plugins](../../engine-phaser/references/scenes-loop-and-plugins.md).

## One owner, many readers

- [tested] A scene created with `input: { keyboard: false, gamepad: false }` has no keyboard or gamepad plugin, so it cannot
  double-handle a key, hold a stale pad wrapper, or remove another scene's blur listener when it restarts
  (`node examples/web/phaser-probes/phaser-input-keyboard.mjs <project>`).
- [general] Pick one scene (or a game-level plugin) as the input owner. It alone creates `Key` objects, reads pads and turns raw
  events into an `ActionState`. Every other scene reads `ActionState` and sets the opt-out above in its scene config, so the
  rule is enforced by the config, not by discipline.
- [general] Pointer input stays per scene, because hit testing needs the scene's cameras and objects. Route it through the same
  contexts as keys (below) and settle ownership of a pointer id at `pointerdown`
  ([pointer and mouse](pointer-and-mouse.md)).
- [documented] Pads are refreshed by each active scene's input plugin inside `InputManager#preRender` (`src/input/InputManager.js`,
  `InputPlugin#updatePoll`), and a paused or sleeping scene is skipped, so a paused owner leaves its pad wrappers at their last
  sample. Keep the owner running and release held pad actions when it pauses.

```ts
// every scene that is not the owner:
super({ key: 'Hud', input: { keyboard: false, gamepad: false } });
```

## Actions, contexts and rebinding

```ts
type Binding = { keys: number[]; pad: number[]; };           // keyCode and standard-mapping button index
type Actions = Record<string, Binding>;                         // 'move-left', 'confirm', 'fire', 'pause'
type Context = 'gameplay' | 'menu' | 'text-entry' | 'modal';   // a stack: only the top context receives actions
```

- [general] Keep the binding table as data with a validator (no key bound twice in one context, every action bound on every device
  the game supports), a partial override from storage, and a controls screen generated from the same table so help text cannot
  drift. Test the validator and the merge as pure functions.
- [documented] Phaser keys are `keyCode`-based, so rebinding stores key codes, and physical-position bindings need an
  `event.code` adapter of your own. Choose Phaser keys or your adapter, not both: with an adapter set `input: { keyboard: false }`
  on the owner and call `preventDefault` yourself.
- [general] Gate by context in the owner: while a modal is open or a text field has focus, gameplay actions are not produced.
  Swallow edges for two or three frames after a screen closes, so the press that closed it does not also act
  ([pixel UI input and controls](../../phaser-pixel-ui/references/pixel-ui-input-and-controls.md)).
- [general] Release every held action on window blur, `visibilitychange` to hidden, device loss, modal open and scene shutdown.
  Phaser resets `Key` objects on blur only for scenes whose listener survived, so do not rely on it ([keyboard](keyboard.md)).

## Handing input to the fixed step

- [tested] Keyboard handlers run inside the DOM event, between frames, so they can write straight into the owner's pending edge
  latch without racing the step. Gamepads are different: pads refresh in the game's `PRE_RENDER` hook, after the scene update of
  the same frame, so a `pad.A` read in `update` is the previous frame's sample (`phaser-input-gamepad.mjs` prints the order
  `POST_STEP`, `pad.update`, `PRE_RENDER`). Accept one frame of pad latency, or refresh the owner's pads in your own
  `PRE_RENDER` listener.
- [general] Build one `InputFrame` per rendered frame: held actions, edges since the last frame (`pressed`, `released`), pointer
  position in sim or UI coordinates, and the active device. The loop gives each fixed step the same held set, and only the first
  step of a frame sees the edges. A frame with zero steps keeps its edges for the next frame, so a tap is never lost; a frame with
  several steps never fires an edge twice.
- [general] Edge sources must be idempotent: a replayed key event ([keyboard](keyboard.md)) or a repeated pad poll must set the
  same latch bit, never increment a counter.
- [general] Convert pointer coordinates once, at sampling, into the space the sim uses (call `camera.preRender()` or wait a frame
  after a zoom change, see [pointer and mouse](pointer-and-mouse.md)). The sim never sees canvas pixels.

## Recording and replay

- [general] Record the `InputFrame` stream (tick, held, edges, aim in sim coordinates) with the seed and the build, not DOM
  events. A replay feeds the same stream through the same `ActionState` interface, so it exercises the sim and the views and
  skips the devices.
- [general] Test the device adapters separately with synthetic input: `new KeyboardEvent('keydown', { keyCode, key })` on
  `window`, Playwright mouse and CDP `Input.dispatchTouchEvent`, and a fake `navigator.getGamepads` that returns fresh snapshots
  ([gamepad and input](gamepad-and-input.md)). Synthetic input proves the mapping, not a physical device.
- [general] Drive the real loop by hand for determinism and assert on actions and sim state, not on handler calls; see
  [verifying the loop](../../phaser-verification/references/verifying-loop-and-waiting.md).

## Enable, disable and lifetime

- [tested] A sleeping scene hears no key events and pausing a scene resets its keys; pausing the owner therefore drops every held
  action, which is usually wanted for a pause menu and a surprise for a HUD scene that owns input.
- [documented] A scene receives input only while its status is above pending and at most running; paused and sleeping scenes are
  skipped (`src/scene/Systems.js#canInput`). `scene.input.enabled = false` and `keyboard.enabled = false` switch one scene's
  devices off without a status change.
- [general] Remove every listener you add to `game.events`, `scale` or `window` on the owner's `SHUTDOWN`, with the same context
  you registered. Count listeners across ten restarts in a spec.
- [general] A text field changes the context: while a DOM input has focus, set the owner's context to `text-entry`, disable key
  capture, and restore both on blur ([DOM overlays and forms](../../phaser-pixel-ui/references/dom-overlays-and-forms.md)).

## Links

[touch input and design](touch-input-and-design.md), [gamepad lifecycle hazards](gamepad-lifecycle-hazards.md).
