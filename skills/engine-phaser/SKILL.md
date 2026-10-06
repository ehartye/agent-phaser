---
name: engine-phaser
description: Build, structure, debug and verify a Phaser (3 or 4) game, especially one with procedural worlds, tilemaps, GPU rendering or agent-sprites and agent-beeps assets. Use before writing Phaser code, when a Phaser render looks wrong, or when choosing how to split rules from rendering. Not for choosing an engine (use engine-selection) or importing assets into other engines.
---

# Phaser

Start here for any Phaser game. It collects what building Fallow Valley
taught, including bugs in Phaser itself that cost hours because nothing in the docs mentions them.

Read the reference that matches the work. Do not load all of them.

| You are about to | Read |
| --- | --- |
| Scan every rule on one page (index with evidence and examples) | [phaser reference](references/phaser-reference.md) |
| Create a project or split a game into layers | [architecture](references/architecture.md) |
| Boot, scenes, a global plugin, the fixed-step loop and interpolation | [scenes, loop and plugins](references/scenes-loop-and-plugins.md) |
| Draw a tilemap, chunk a world, add overlays or animated tiles | [tilemaps and terrain](references/tilemaps-and-terrain.md) |
| Hit a render that is blank, doubled, stale, wrong-coloured or throws | [Phaser 4 gotchas](references/phaser-4-gotchas.md) |
| Add day and night, lights, fog, saturation or heat shimmer without blurring pixel art | [lighting and atmosphere](references/lighting-and-atmosphere.md) |
| Make the canvas pixel-exact at any devicePixelRatio, or build a pixel-only UI | [pixel-perfect and UI](references/pixel-perfect-and-ui.md) |
| Drive sound from sim events, write a music state machine | [audio directors](references/audio-directors.md) |
| Measure and fix frame cost, draw calls, pooling | [performance](references/performance.md) |
| Add drifting shadows, wind, particles, weather or footsteps to a strict pixel game | [ambient motion](references/ambient-motion.md) |
| Add gamepad or controller support, glyph prompts, or on-screen keyboards | [gamepad and input](references/gamepad-and-input.md) |
| Prove a change works on a real GPU | [verifying on a real GPU](references/verifying-on-a-gpu.md) |
| Load agent-sprites or agent-beeps output | [asset wiring](references/asset-wiring.md) |

## First five minutes

1. **Pin the version and say which.** `npm view phaser version` and `npm view phaser dist-tags`. As of 2026-07 the
   `latest` tag is 4.2.1; the `beta` tag is a stale 4.0.0-rc.7 and must not be mistaken for something newer. Pin the exact
   version in `package.json`. Phaser 4 is a different renderer from 3 (render nodes, filters, GPU tilemap layers); sample
   code written for 3 often does not apply.
2. **Read Phaser's own skills.** Phaser 4 ships about 600 KB of skill documents in `node_modules/phaser/skills`
   (scenes, tilemaps, filters and post effects, v4 features, v3 to v4 migration, data manager, particles). They are
   accurate to the installed version. Prefer them to memory and to web posts.
3. **Check what the renderer really is.** Print the WebGL renderer string (`WEBGL_debug_renderer_info`). Headless
   browsers silently fall back to software rendering, which hides performance and some correctness problems.
4. **Put rules in a headless layer.** Keep game state and rules in plain TypeScript that never imports Phaser, and let
   Phaser draw it. See [architecture](references/architecture.md). This single choice makes the game unit-testable,
   saves small, and scene restarts safe.
5. **Decide the verification up front.** A unit-test suite plus a Playwright suite that runs on the GPU and asserts
   on *pixels*, not on "no console errors". See [verifying](references/verifying-on-a-gpu.md).

## Rules that earned their place

- **Measure pixels, not impressions.** A screenshot that "looks plausible" hid a layer covering the whole terrain for
  hours. Read a pixel at a place whose expected colour you know, then toggle layers and read it again.
- **Isolate before theorising.** Build the smallest standalone object that should work inside the live scene and
  compare it with the real pipeline. Three of the Phaser bugs below were found this way in minutes after hours of
  reasoning.
- **Prove a regression test by mutation.** Re-introduce the bug, watch the test fail, restore the fix.
- **Every runtime use of a Phaser value needs `import Phaser from 'phaser'`.** Phaser's types are a global namespace, so
  a missing import compiles and then throws `Phaser is not defined`. Add a test that scans for it.
- **Never use wall-clock or `Math.random` in rules.** Use a seeded generator and a fixed timestep, and save the generator's
  state in the snapshot: otherwise a loaded game restarts the random stream and drifts from the original (test it by stepping a
  saved and a restored sim side by side).
- **Every scene restart must be leak-tested.** Restart the scene ten times in a browser spec and require listener counts,
  textures and display objects not to grow (gotchas 14 and 15); a WebGL context loss/restore spec belongs beside it (gotcha 13).
- **Games for this owner use a strict pixel-only UI.** Every visible UI and message pixel comes from agent-sprites bitmap
  fonts, skins and icons (no browser text, no Phaser `Text`); the UI layer may have a higher resolution than the gameplay
  layer, but each layer uses one integer scale. Ban `Text` creation with a test.
- **When a tool is missing something, fix the tool.** Capabilities the game needs from agent-sprites or agent-beeps
  belong in those tools (with a tracked backlog item), not in game-side workarounds.

## Not covered here

Choosing between Phaser, three.js, Godot and the rest is [engine-selection](../engine-selection/SKILL.md). Custom
Canvas or WebGL post effects outside Phaser are [engine-custom-shaders](../engine-custom-shaders/SKILL.md). Exporting
assets for other engines is [engine-asset-import](../engine-asset-import/SKILL.md).
