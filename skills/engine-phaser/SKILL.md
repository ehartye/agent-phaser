---
name: engine-phaser
description: Build, structure, debug and verify a Phaser (3 or 4) game, especially one with procedural worlds, tilemaps, GPU rendering or agent-sprites and agent-beeps assets. Use before writing Phaser code, when a Phaser render looks wrong, when a game misses a frame budget (Chrome DevTools performance, long animation frames, frame time percentile), or when choosing how to split rules from rendering. Not for choosing an engine (use engine-selection) or importing assets into other engines.
---

# Phaser

Start here for any Phaser game. It collects lessons from building Phaser 4 games,
including undocumented Phaser bugs that cost hours.

Read the reference that matches the work, not all of them.

| You are about to | Read |
| --- | --- |
| Coordinate shared contracts or testing/publication costs across Phaser games and tools | [Phaser architecture coordination](../phaser-architecture/SKILL.md) |
| Scan every rule on one page (evidence, examples) | [phaser reference](references/phaser-reference.md) |
| Create a project or split a game into layers | [architecture](references/architecture.md) |
| Boot, scenes, a global plugin, the fixed-step loop and interpolation | [scenes, loop and plugins](references/scenes-loop-and-plugins.md) |
| Choose WebGL 1/2, integrate ES3 shaders or distinguish Phaser AE | [WebGL backends](references/webgl-backends.md) |
| Draw a tilemap, chunk a world, add overlays or animated tiles | [tilemaps and terrain](references/tilemaps-and-terrain.md) |
| Hit a render that is blank, doubled, stale, wrong-coloured or throws | [Phaser 4 gotchas](references/phaser-4-gotchas.md): [tilemaps](references/phaser-4-tilemap-gotchas.md), [API and effects](references/phaser-4-api-and-effects-gotchas.md), [scene lifecycle](references/phaser-4-scene-lifecycle-gotchas.md), [context loss and restore](references/phaser-4-webgl-context-gotchas.md), [renderer destruction](references/phaser-4-renderer-destruction-gotchas.md) |
| Add day and night, lights, fog, saturation or heat shimmer without blurring pixel art | [lighting and atmosphere](references/lighting-and-atmosphere.md) |
| Make the canvas pixel-exact, build pixel UI, or clip a scrolling pane in WebGL | [pixel-perfect and UI](references/pixel-perfect-and-ui.md): [footprint](references/pixel-perfect-footprint.md), [text and panels](references/pixel-perfect-text-and-panels.md), [input and controls](references/pixel-ui-input-and-controls.md), [clipped scrolling](references/pixel-ui-clipped-scrolling.md) |
| Play exported recordings, own audio loading and lifecycle in Phaser | [native recorded audio](references/native-audio.md), [4.2.1 corrections](references/native-audio-corrections.md) |
| Use the beeps procedural/adaptive player and direct game sound decisions | [audio directors](references/audio-directors.md) |
| Measure and fix frame cost, draw calls, pooling | [performance](references/performance.md) |
| Hit a frame budget (60 or 120 fps) or cost +25% to +50% more content: decompose, ablate, price items, prove a fix exact | [profiling method](references/profiling-method.md), [Chrome frame budget](references/chrome-frame-budget.md) |
| Add drifting shadows, wind, particles, weather or footsteps to a strict pixel game | [ambient motion](references/ambient-motion.md) |
| Add gamepad or controller support, glyph prompts, or on-screen keyboards | [gamepad and input](references/gamepad-and-input.md), [lifecycle hazards](references/gamepad-lifecycle-hazards.md) |
| Add touch or mobile support: tap to move, gestures, on-screen buttons, safe areas, phone render quality, touch tests | [touch and mobile](references/touch-and-mobile.md): [input and design](references/touch-input-and-design.md), [tap to move, page, tests](references/touch-tap-to-move-and-page.md) |
| Prove a change works on a real GPU | [verifying on a real GPU](references/verifying-on-a-gpu.md): [setup](references/verifying-playwright-setup.md), [assertions and harness](references/verifying-assertions-and-harness.md), [loop and waiting](references/verifying-loop-and-waiting.md) |
| Load agent-sprites or agent-beeps output | [asset wiring](references/asset-wiring.md) |
| Ship audio: lock, store, Opus-only format, unsupported-browser notice, decoded-memory budget, a CI that fetches instead of rendering | [audio integration](../engine-asset-import/references/audio-integration.md), [CI for generated assets](../engine-asset-import/references/ci-for-generated-assets.md) |

## First five minutes

1. [general] **Pin the version and say which.** `npm view phaser version` and `npm view phaser dist-tags`. As of 2026-07 the
   `latest` tag is 4.2.1; the `beta` tag is a stale 4.0.0-rc.7. Pin the exact
   version in `package.json`. Phaser 4 is a different renderer from 3 (render nodes, filters, GPU tilemap layers); sample
   code written for 3 often does not apply.
2. [documented] **Read Phaser's own skills.** Phaser 4 ships about 600 KB of skill documents in `node_modules/phaser/skills`
   (scenes, tilemaps, filters and post effects, v4 features, v3 to v4 migration, data manager, particles). They are
   accurate to the installed version. Prefer them to memory and to web posts.
3. [general] **Check what the renderer really is.** Print the WebGL renderer string (`WEBGL_debug_renderer_info`). Headless
   browsers silently fall back to software rendering, which hides performance and some correctness problems. Phaser 4
   officially supports WebGL 2; 4.2.1 creates WebGL 1 by default and accepts a supplied WebGL 2 context. `Phaser.WEBGL`
   is not an API-version selector. Read [WebGL backends](references/webgl-backends.md) for ES3 shaders and Phaser AE.
4. [general] **Put rules in a headless layer.** Keep game state and rules in plain TypeScript that never imports Phaser, and let
   Phaser draw it. See [architecture](references/architecture.md). This single choice makes the game unit-testable,
   saves small, and scene restarts safe.
5. [general] **Decide the verification up front.** A unit-test suite plus a Playwright suite that runs on the GPU and asserts
   on *pixels*, not on "no console errors". See [verifying](references/verifying-on-a-gpu.md).

## Rules that earned their place

- [general] **Use Phaser's native capability first.** Configure and test it before adding a parallel implementation. For controller input,
  see [gamepad and input](references/gamepad-and-input.md): configurable thresholds are not defects; lifecycle workarounds require
  a version-specific reproduction, one input owner and a removal condition.
- [general] **Measure pixels, not impressions.** Read a pixel at a place whose expected colour you know, toggle layers and read it again;
  a plausible-looking screenshot can hide a layer covering the terrain.
- [general] **Isolate before theorising.** Build the smallest standalone object that should work inside the live scene and
  compare it with the real pipeline; this found several Phaser bugs in minutes.
- [general] **Prove a regression test by mutation.** Re-introduce the bug, watch the test fail, restore the fix.
- [general] **Import Phaser wherever a value is used.** A missing import compiles, then throws `Phaser is not defined` (gotcha 4); add a scanning test.
- [general] **Never use wall-clock or `Math.random` in rules.** Use a seeded generator and a fixed timestep, and save the generator's
  state in the snapshot: otherwise a loaded game restarts the random stream and drifts from the original (test it by stepping a
  saved and a restored sim side by side).
- [general] **Every scene restart must be leak-tested.** Restart the scene ten times in a browser spec and require listener counts,
  textures and display objects not to grow (gotchas 14 and 15); a WebGL context loss/restore spec belongs beside it (gotcha 13).
- [general] **A strict pixel-only UI** draws every UI and message pixel from agent-sprites bitmap fonts, skins and icons (no browser text,
  no Phaser `Text`; ban `Text` creation with a test). The UI layer may have a higher resolution than the gameplay layer; require
  whole physical pixels per authored source pixel in each context. Fractional logical units and camera scales are valid when final
  footprints and paint origins align. Keep accessible controls and native text entry through the shared-model semantic bridge (see
  [pixel-perfect and UI](references/pixel-perfect-and-ui.md)); a live region alone is not an interactive interface.
- [general] **When a tool is missing something, fix the tool.** Capabilities the game needs from agent-sprites or agent-beeps
  belong in those tools (with a tracked backlog item), not in game workarounds.

## Not covered here

Choosing between Phaser, three.js, Godot and the rest is [engine-selection](../engine-selection/SKILL.md). Custom
Canvas or WebGL post effects outside Phaser are [engine-custom-shaders](../engine-custom-shaders/SKILL.md). Exporting
assets for other engines is [engine-asset-import](../engine-asset-import/SKILL.md).
