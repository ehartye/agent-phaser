# Keyboard in Phaser 4.2.1: keys, events, captures and scene lifetime

How the keyboard plugin really delivers keys, and the four ways it surprises a multi-scene game. Reproduce all of it with
`node examples/web/phaser-probes/phaser-input-keyboard.mjs <project>` (Canvas renderer, no GPU). Phaser's own overview is
`node_modules/phaser/skills/input-keyboard-mouse-touch/SKILL.md`; this file only adds what it omits.

## Keys or events

| You need | Use | Watch for |
| --- | --- | --- |
| A held direction | `Key.isDown` read in the input owner's update | `addKey` captures the key globally (below) |
| One action per press | the `Key` `down` event | replayed events (below); `JustDown` is a latch |
| Every press, even a tap shorter than a frame | the `Key` `down` event | polling `isDown` and `JustDown` miss it |
| Typed text | a DOM `<input>` (see [dom overlays](../../phaser-pixel-ui/references/dom-overlays-and-forms.md)) | never build text entry from `keydown` |
| Bindings by physical position (WASD on any layout) | your own `event.code` adapter | Phaser reads `keyCode` only |

- [documented] `JustDown(key)` clears `key._justDown` when it returns true, so the second reader in a frame gets false, and a press
  nobody polled stays latched until someone does (`src/input/keyboard/keys/JustDown.js`).
- [tested] A `keydown` and `keyup` dispatched inside one frame leave `isDown` false and `JustDown` false; the `down` event still fires.
- [documented] The plugin never reads `event.code` (a search of `src/input/keyboard` finds none); every key is looked up by
  `event.keyCode`.
- [general] `keyCode` follows the character a key produces, so a WASD cluster is not the same physical keys on an AZERTY or Dvorak
  layout; offer rebinding, or read `event.code` in an adapter of your own.
- [tested] For a code that has a `Key` object in a scene, OS auto-repeat is dropped from that scene's `keydown` and `keydown-X` events
  (only `Key.emitOnRepeat` re-emits `down`); for a code without one, every repeat arrives with `event.repeat` true.

## Delivery is synchronous, shared and replayed

- [documented] The DOM listener pushes each event onto the manager queue and emits `MANAGER_PROCESS` at once; every scene's plugin
  walks the queue inside that DOM event, and `POST_STEP` empties it (`src/input/keyboard/KeyboardManager.js`). Handlers therefore run
  between frames, never inside `update`, and cannot interleave with a fixed step.
- [tested] One DOM key event reaches the listeners of every active scene that has a keyboard plugin, so a `keydown` handler
  registered in two scenes fires twice.
- [tested] The plugin re-walks the whole queue on every DOM event and skips only an event equal to the one it processed last. Five
  events inside one frame (`dn A, up A, dn B, up B, dn C`) were delivered to a listener 14 times, and `Key` A emitted `down` four
  times. Symptom: doubled letters, double-fired actions on a chord or after a hitch. Fix: in every raw `keydown` and `keyup` handler
  keep a `WeakSet<KeyboardEvent>` and return for an event already seen; the replays are the same object.

```ts
const seen = new WeakSet<KeyboardEvent>();
owner.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
  if (seen.has(event)) return;          // replayed, or already handled
  seen.add(event);
  actions.press(bindings.fromKey(event.keyCode));   // one action per physical press
});
```

- [tested] `event.stopPropagation()` in a handler hides the event from scenes whose plugin started later; the order is plugin start
  order, so a restarted scene moves to the end. Treat it as a convenience, not the routing design.
- [tested] A sleeping scene receives nothing; pausing a scene resets its keys.

## Captures and text fields

- [documented] `addKey(key, enableCapture = true, emitOnRepeat = false)` and `addKeys` add the code to a global capture list;
  `removeKey` and the shutdown path leave it there (`src/input/keyboard/KeyboardPlugin.js`).
- [tested] A captured, unmodified key has `preventDefault` called on its `keydown`. After a scene did `addKeys('W,A,S,D')` and was
  stopped, typing `wasd go` into a DOM input produced ` go`; `clearCaptures()` restored it. Shift, Ctrl, Alt and Meta combinations
  are never prevented. Fix: `addKey(code, false)` where the browser default is wanted, and `removeCapture` or `clearCaptures` when
  leaving gameplay.
- [tested] `disableGlobalCapture()` stops the prevention for the whole game until `enableGlobalCapture()`; the flag lives on the
  shared manager, not on the calling scene.
- [tested] Key events from a focused DOM field bubble to `window` and reach Phaser, so typing `w` moves the player. Either set
  `keyboard.enabled = false` on the owner while a field has focus, or create the game with
  `input: { keyboard: { target: canvas } }` on a canvas with `tabindex`, after which field keystrokes never arrive. The cost of the
  second is that the canvas must hold focus for any game key to work.

## Scene lifetime

- [tested] A scene created with `input: { keyboard: false, gamepad: false }` has no keyboard or gamepad plugin and no listeners.
- [tested] `KeyboardPlugin#shutdown` calls `game.events.off(BLUR, resetKeys)` without the scene context, and `resetKeys` is one
  shared function, so stopping or restarting one scene removes the window-blur reset of every scene. A key held across Alt-Tab
  stays down in the survivors. Fix: keep keyboard in one owner scene and give every other scene the opt-out above; the owner is
  then never affected by another scene's restart. Remove any workaround when the probe's `survivorKeepsStuckKeyAfterOtherSceneRestart` is false.

## Verify

- [tested] Synthetic `new KeyboardEvent('keydown', { keyCode, key, bubbles: true })` dispatched on `window` drives the plugin,
  because Phaser reads `keyCode`; use it for adapter tests and Playwright `keyboard.down` for end-to-end.
- [general] Assert state after the event (`isDown`, the action snapshot), not the call to a handler, and add the replay case (three
  or more events in one task) to every key-handling suite.

## Links

[input architecture](input-architecture.md), [pointer and mouse](pointer-and-mouse.md), [gamepad lifecycle hazards](gamepad-lifecycle-hazards.md),
[input in a hand-driven loop](../../phaser-verification/references/deterministic-test-driving.md).
