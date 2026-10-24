---
name: phaser-input
description: Handle player input in a Phaser 4.2.1 game - keyboard, pointer and mouse, gamepad and touch - with one input owner per game and correct scene lifetime. Use when keys fire twice, stick after a scene restart or Alt-Tab, or are swallowed in a text field; when a press reaches the wrong scene or a DOM button also clicks the world under it; when pointer.worldX is stale; when adding controller, glyph-prompt, on-screen keyboard or touch and mobile support; or when input must be replayed in tests. Not for pixel UI controls and the accessibility bridge (phaser-pixel-ui), audio (phaser-audio) or end-to-end test harnesses (phaser-verification).
---

# Phaser input

Phaser ships native keyboard, pointer, gamepad and touch handling. Configure and test it before adding a parallel implementation.
Targets Phaser 4.2.1; behaviour that differs from Phaser's own docs is reproduced by a probe under `examples/web/phaser-probes/`.

| You are about to | Read |
| --- | --- |
| Read keys, add captures, handle repeats, or type into a text field next to a game | [keyboard](references/keyboard.md) |
| Route presses between scenes, size hit areas, map pointer coordinates, or put DOM over the canvas | [pointer and mouse](references/pointer-and-mouse.md) |
| Structure input: one owner, actions and rebinding, the handoff to the fixed step, replay in tests | [input architecture](references/input-architecture.md) |
| Read a gamepad: named properties, mapping, events, vibration | [gamepad API reference](references/gamepad-api-reference.md) |
| Add gamepad or controller support, glyph prompts, or on-screen keyboards | [gamepad and input](references/gamepad-and-input.md), [lifecycle hazards](references/gamepad-lifecycle-hazards.md) |
| Add touch or mobile support: tap to move, gestures, on-screen buttons, safe areas, phone render quality, touch tests | [touch and mobile](references/touch-and-mobile.md): [input and design](references/touch-input-and-design.md), [tap to move, page, tests](references/touch-tap-to-move-and-page.md) |

## Rules that earned their place

- [general] **Use Phaser's native capability first.** Configurable thresholds are not defects; a lifecycle workaround requires a
  version-specific reproduction, one input owner and a removal condition.
- [tested] **A key event reaches every scene that has a keyboard plugin, three or more events in one frame replay earlier ones, and
  restarting any one scene removes every scene's window-blur key reset.** Keep keyboard in one owner scene, give the others
  `input: { keyboard: false, gamepad: false }`, and dedupe raw handlers by event identity (`phaser-input-keyboard.mjs`).
- [tested] **`addKey` and `addKeys` capture their keys globally and the capture outlives the scene**, so a DOM field cannot receive
  those letters. Pass `enableCapture = false` or call `clearCaptures()` when leaving gameplay.
- [tested] **An interactive object under the pointer in an upper scene hides the press from lower scenes** (`globalTopOnly`);
  `this.input.stopPropagation()` hides the down but not the later up, so record the owner of each pointer id at down
  (`phaser-input-pointer.mjs`).
- [tested] **`pointer.worldX` is stale after a camera move without a pointer move, and `getWorldPoint` is stale until the next render**;
  call `pointer.updateWorldPoint(camera)` and `camera.preRender()`.
- [tested] **A DOM element above the canvas also presses the Phaser object beneath it**; stop `mousedown`, `mouseup` and the touch
  events at the element.
- [tested] **Gamepad state refreshes after the scene update, and the named properties assume a standard mapping**
  (`phaser-input-gamepad.mjs`); check `mapping` and accept one frame of latency.
- [general] **Test with real input.** Drive the mouse, key and touch paths the player uses, not a direct call to the handler.

## Not covered here

Pixel UI controls and the accessibility bridge are [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md). The fixed-step loop that
consumes input is [engine-phaser](../engine-phaser/SKILL.md). Driving a whole session is
[phaser-verification](../phaser-verification/SKILL.md).
