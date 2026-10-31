# Pixel UI: input capture and accessible controls (Phaser 4.2.1)

The keyboard queue, accessible controls and native input. Index: [pixel-perfect-and-ui.md](pixel-perfect-and-ui.md).

## 6. Input capture and the keyboard queue

- [general] One shared UI state (`{ capture, pointerOnUi, paused }`) on the registry. While a modal is open, and for a few frames after it closes,
  the world ignores movement, hotbar and tile clicks, so the key that closed a screen does not also act.
- [general] **A keydown can reach a handler twice.** The keyboard queue is on the shared manager and every active scene's `KeyboardPlugin.update`
  dispatches it to its own listeners (`src/input/keyboard/KeyboardPlugin.js#L733`); the duplicate guard is per plugin. With the title and
  the world both active, a handler registered in both sees one DOM event twice (a typed name came out "AAda"). Dedupe by event identity
  (`WeakSet<KeyboardEvent>`) in every interface handler; the same object is also replayed when three or more key events land in one frame
  ([keyboard](../../phaser-input/references/keyboard.md)), which the same guard absorbs.
- [general] Focus is spatial for menus on a pad (nearest node in a direction; drift across the axis counts double; wrap) and kept as a pure function
  (see [gamepad and input](../../phaser-input/references/gamepad-and-input.md)).

## 7. Accessible controls and native input without a second UI implementation

Pixel-only describes the game's visible rendering, not its accessibility tree. An `aria-live` node can announce a message but cannot
replace navigable buttons, named controls, selection state or editable text. Preserve those capabilities when porting an existing game.

- [general] Define each screen's labels, actions, enabled/selected state and input values once. The Phaser view and semantic DOM projection consume
  that model and invoke the same action handlers. DOM measurements must not drive Phaser layout; do not maintain a second set of menus or rules.
- [general] Project the interactive controls needed by assistive technology as real semantic elements with appropriate names, state and focus order.
  Visually conceal that projection without removing it from the accessibility tree (`display:none`, `hidden` and `aria-hidden` are not
  suitable for controls that must remain accessible). Use one live region for status updates where appropriate, without duplicate announcements.
- [general] For character names, save-slot names or other editable fields, use a native input/textarea bridge for IME, selection, paste and the mobile
  software keyboard. Share its value and composition state with the bitmap presentation. Focus it from a real user gesture; support composition
  events and commit/cancel without letting typing trigger game commands. Keep browser chrome out of the rendered game; the OS keyboard remains native.
- [general] Synchronize semantic and visual focus, visibly indicate focus in Phaser, contain it in modals and restore it on close. When a modal opens,
  underlying controls must stop being actionable in both projections. Manage listeners and DOM nodes with the owning scene's shutdown lifecycle.
- [general] Verify keyboard-only navigation, assistive-technology activation reaching the same handler exactly once, names/states, focus restoration,
  text composition and repeated scene teardown. Inspect visible pixels separately. Test the actual mobile keyboard and VoiceOver on iPhone;
  desktop DOM tests and simulated events do not establish those device behaviors.

An `aria-live` announcement helper is not evidence of complete interactive accessibility. A one-node architecture assertion is
too restrictive for games with semantic controls or native text entry. The bounded example below verifies part of this architecture;
it does not establish consumer adoption or all the device behaviors above.

## 8. Bounded desktop bridge evidence

- [tested] The [model/action example](../../../examples/web/harness/accessibility-bridge.mjs) owns control labels, enabled/selected state, field values, modal eligibility and focus identity. Its [fixture](../../../examples/web/harness/accessibility-bridge-fixture.mjs) projects Canvas controls and visually concealed native buttons/input from that model. Actual pointer and semantic keyboard routes invoke the same original action owner once. DOM dimensions never determine Canvas layout. `node --test tests/phaser-accessibility-bridge.test.mjs` covers public action, refusal and lifecycle boundaries.
- [tested] `node examples/web/phaser-probes/phaser-pixel-ui-accessibility-bridge.mjs <host>` runs Phaser 4.2.1 with desktop Chromium and declares `CanvasRenderer`. CDP `Accessibility.getFullAXTree` supplies the native tree; only nodes with `ignored: false` satisfy required role/name/state witnesses. Concealed controls remain present while `display:none`, `hidden` and `aria-hidden` examples are absent from the unignored tree. DOM presence and successful focus alone are insufficient evidence.
- [tested] Real pointer, Tab, Shift+Tab, Enter, Escape and text input exercise selected state, the disabled control's skipped tab position, field value updates, Canvas focus strokes, modal background inertness, contained focus and opener restoration. Ten full fixture disposal/recreation cycles release owned listeners, subscriptions, DOM and canvases; retired action owners receive no new calls. This is full fixture teardown, not a claim about arbitrary scene restart integration.

The host supplies Phaser 4.2.1 and `@playwright/test`; `CHROME_CHANNEL` optionally selects another Chromium channel. The entrypoint accepts `--output <evidence>` or creates a unique temporary directory and prints its path. It runs in the runner's software lane. Browser execution remains separate from the dependency-free merge gate.

```sh
node examples/web/phaser-probes/phaser-pixel-ui-accessibility-bridge.mjs /path/to/host
node examples/web/phaser-probes/phaser-pixel-ui-accessibility-bridge.mjs /path/to/host --mutation aria-hidden
node examples/web/phaser-probes/phaser-pixel-ui-accessibility-bridge.mjs /path/to/host --mutation duplicate-action
```

- [tested] Each mutation exits 1 through its real witness: `aria-hidden` removes the required Music button from the unignored AX tree; `duplicate-action` makes a real keyboard activation reach the original handler twice. An escaped mutation exits 0. Inspect `report.json`, `failure.ax.json`, `failure.png` and `failure.trace.zip`, not only exit status. Reports preserve source/browser identities, original-owner receipts and failure state before cleanup; cleanup results record fixture disposal and CDP/context/browser/server release. The normal run retains AX snapshots, `positive.png` and `positive.trace.zip`.

This evidence does not establish screen-reader interoperability, device IME/composition behavior, mobile keyboards, blanket compliance, authored paint or GPU acceptance. The fixture uses Canvas text to demonstrate state projection, not a strict bitmap-font rendering contract. Capture readiness and the manual-loop/externally stepped-clock experiment are separate obligations; the probe supplies no filming adapter or second clock owner.
