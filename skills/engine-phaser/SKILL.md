---
name: engine-phaser
description: Start and structure a Phaser 4 game - pin the version, write the game config (WebGL, pixelArt, fps), boot and bundle it with Vite or ESM, size and scale the canvas for windows and high-density screens, load assets and handle failures, organise scenes and the fixed-step loop, own events and state across scene restarts, use containers, groups and pools, and port Phaser 3 code. Use before writing Phaser code, when a scene restart leaks, an asset fails to load, the canvas is the wrong size or shape after a resize, or a tutorial's API does not exist in 4.2.1. Domain skills cover rendering, worlds, physics, motion, pixel UI, input, audio and verification. Not for choosing an engine (engine-selection) or importing assets into other engines (engine-asset-import).
---

# Phaser core

Start here for any Phaser game. It collects lessons from building Phaser 4 games, including undocumented Phaser bugs that cost
hours, plus facts reproduced against 4.2.1 by the [foundations probe](../../examples/web/phaser-probes/engine-phaser-foundations.mjs).
Read the reference that matches the work, not all of them.

| You are about to | Read |
| --- | --- |
| Scan every rule on one page (evidence, examples) | [phaser reference](references/phaser-reference.md) |
| Create a project or split a game into layers | [architecture](references/architecture.md) |
| Write `new Phaser.Game(config)`, choose `pixelArt`, limit fps, wire Vite or ESM, destroy a game | [config and boot](references/config-and-boot.md) |
| Fit, resize or fullscreen the canvas, or fix blur on a high-density screen | [scale and responsive](references/scale-and-responsive.md) |
| Load, retry, progress-bar or release assets, or pick an atlas or compressed format | [loading assets](references/loading-assets.md) |
| Boot, scenes, a global plugin, the fixed-step loop and interpolation | [scenes, loop and plugins](references/scenes-loop-and-plugins.md) |
| Hit a scene restart that leaks, double-registers or fires events twice | [scene lifecycle gotchas](references/phaser-4-scene-lifecycle-gotchas.md) |
| Subscribe to events, pass data between scenes or decide where state lives | [events and data](references/events-and-data.md) |
| Group sprites, use a Container, Layer or pool, or destroy objects | [game objects and containers](references/game-objects-and-containers.md) |
| Load agent-sprites or agent-beeps output | [asset wiring](references/asset-wiring.md) |
| Port Phaser 3 code or follow an old tutorial | [Phaser 3 to 4](references/v3-to-v4-migration.md) |

## First five minutes

1. [general] **Pin the version and say which.** `npm view phaser version` and `npm view phaser dist-tags`. As of 2026-07 the
   `latest` tag is 4.2.1; the `beta` tag is a stale 4.0.0-rc.7. Pin the exact version in `package.json`. Phaser 4 is a different
   renderer from 3 (render nodes, filters, GPU tilemap layers); sample code written for 3 often does not apply
   ([what to ignore](references/v3-to-v4-migration.md)).
2. [documented] **Read Phaser's own skills.** Phaser 4 ships about 600 KB of skill documents in `node_modules/phaser/skills`
   (scenes, tilemaps, filters and post effects, v4 features, v3 to v4 migration, data manager, particles). They match the
   installed version and beat memory and web posts, with the exceptions these references test (for example `FIT` ignores
   `zoom`, see [scale](references/scale-and-responsive.md)).
3. [general] **Put rules in a headless layer.** Keep game state and rules in plain TypeScript that never imports Phaser, and let
   Phaser draw it. See [architecture](references/architecture.md). This single choice makes the game unit-testable, saves small,
   and scene restarts safe.
4. [general] **Decide the verification up front.** A unit-test suite plus a Playwright suite that runs on the GPU and asserts on
   *pixels*, not on "no console errors". See [phaser-verification](../phaser-verification/SKILL.md).

## Rules that earned their place

- [general] **Import Phaser wherever a value is used.** A missing import compiles, then throws `Phaser is not defined`; add a
  scanning test. [tested] The ESM build never sets `window.Phaser` (`config-esm-has-no-global`).
- [general] **Never use wall-clock or `Math.random` in rules.** Use a seeded generator and a fixed timestep, and save the
  generator's state in the snapshot: otherwise a loaded game restarts the random stream and drifts from the original (test it by
  stepping a saved and a restored sim side by side).
- [tested] **Every scene restart must be leak-tested.** `scene.events`, `scene.data`, the registry and the previous start data all
  survive a restart. Restart ten times and require a listener census, textures and display objects not to grow
  ([events and data](references/events-and-data.md)).
- [tested] **Fail loudly at boot.** `parent` is an element id (`'#game'` lands in `body`), a 404 is never retried, and `complete`
  fires with failures: assert the canvas parent and gate the first scene on `totalFailed === 0`
  ([config](references/config-and-boot.md), [loading](references/loading-assets.md)).
- [tested] **Integer scale is not automatic.** `FIT` ignores `zoom` and scales by 2.5; `snap` needs `min`; the canvas is not
  device-pixel aware (`NONE`, `zoom: 1 / dpr`). Test sizes at several window sizes and ratios
  ([scale](references/scale-and-responsive.md)).
- [tested] **A Container is not a Layer.** A Container draws in list order and centres its hit area; a Layer sorts by depth;
  `Group#get` hands out a dead member without reviving it ([game objects](references/game-objects-and-containers.md)).
- [general] **When a tool is missing something, fix the tool.** Capabilities the game needs from agent-sprites or agent-beeps
  belong in those tools (with a tracked backlog item), not in game workarounds.

The `[tested]` rules are reproduced by `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project>`; the host
project supplies `phaser` 4.2.1 and `@playwright/test`, and a software renderer is enough.

## Domain skills

- [general] **Phaser is split by system, so pick the skill for the work.** Each owns its references, patches and rules.

| Work | Skill |
| --- | --- |
| WebGL, render nodes, filters, shaders, stencil, meshes, textures, context loss | [phaser-rendering](../phaser-rendering/SKILL.md) |
| Tilemaps, chunk streaming, cameras, lights, weather and particles | [phaser-worlds](../phaser-worlds/SKILL.md) |
| Arcade and Matter physics, collision, tilemap collision, pathing | [phaser-physics](../phaser-physics/SKILL.md) |
| Tweens, timelines, animations, timers, curves | [phaser-motion](../phaser-motion/SKILL.md) |
| Pixel-exact canvas, bitmap text, panels, accessible controls | [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md) |
| Keyboard, pointer, gamepad, touch | [phaser-input](../phaser-input/SKILL.md) |
| Native audio, lifecycle, beeps directors | [phaser-audio](../phaser-audio/SKILL.md) |
| Real-GPU checks, profiling, frame budgets | [phaser-verification](../phaser-verification/SKILL.md) |
| Contracts and testing cost across several games | [phaser-architecture](../phaser-architecture/SKILL.md) |

## Not covered here

Choosing between Phaser, three.js, Godot and the rest is [engine-selection](../engine-selection/SKILL.md). Custom Canvas or WebGL
post effects outside Phaser are [engine-custom-shaders](../engine-custom-shaders/SKILL.md). Exporting assets for other engines is
[engine-asset-import](../engine-asset-import/SKILL.md).
