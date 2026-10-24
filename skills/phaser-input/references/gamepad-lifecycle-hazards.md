# Gamepad input: version-scoped lifecycle hazards and the fallback gate

Index: [gamepad-and-input.md](gamepad-and-input.md).

## Version-scoped lifecycle hazards and fallback gate

Verified against installed Phaser **4.2.1** source (`src/input/gamepad/{Button,Axis,Gamepad,GamepadPlugin}.js`) and synthetic
fresh snapshots in Chrome on Windows, 2026-10-06. These are conditions to reproduce in the target game, not claims about all
browsers or later Phaser versions:

- [general] `Gamepad.update(pad)` updates controls but retains its original `this.pad`. With fresh snapshots, `.connected` and `.timestamp`
  can be stale. Prefer lifecycle events to those cached properties for device loss.
- [general] `refreshPads()` skips null slots without pruning cached pads; `total` is the sparse array length, and `pad1` to `pad4` can
  retain stale aliases. Track event-based membership by device index; do not infer active membership from aliases or `total`.
- [general] `update` ignores snapshots whose timestamp is earlier than `_created`. The trial reproduced ignored controls at timestamp 0.
  Test held input on initial acquisition and resume, including a valid older unchanged timestamp; do not merely make a mock's
  timestamp advance every frame and declare lifecycle parity.
- [general] Scene plugins have independent control state. One action owner prevents duplicate dispatch; test its shutdown/restart and
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
cycles. The isolated Chromium 153 / Playwright 1.63.0 run passed on a hybrid-GPU laptop's discrete GPU through ANGLE/D3D11, including initial
held analog acquisition, different-id replacement, ten actual Scene restarts and native destruction/listener cleanup. A separately
reproduced pending-event stop/start retained two events and replayed both callbacks; clearing the native queue on shutdown prevented
that replay while a later native connection event still fired once. Served optimized
bytes were tied to the corrected consumed ESM through the actual source map. These are synthetic-input results, not physical-controller
certification; sparse cached membership/aliases and the independent timestamp gate remain outside this helper.

Remove the helper after upgrading to an upstream version verified without it: usable FIFO connection capture must precede held edges,
neutral release must permit exactly one fresh press, and Scene shutdown/restarts must retire queued events and keep native listeners bounded. A version change
alone is not the removal test.
