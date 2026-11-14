---
name: engine-phaser
description: Entry point for any work on a Phaser 4 game - project setup, game config, canvas scaling, asset loading, scenes and the fixed-step loop, where state, rules and UI live, porting Phaser 3 code. Use when working in a project that depends on phaser and no domain skill clearly owns the task, even when the user names only the result and never mentions Phaser. Also use when starting a Phaser game, building its first level, deciding how one game's scenes, simulation and UI are organised, adding save and load, when a scene restart leaks or fires events twice, an asset fails to load, the page crashes, goes black or reloads on a phone when a level starts, the canvas is the wrong size after a resize, or a tutorial's API does not exist in 4.2.1. The domain skills cover effects, worlds, collision, motion (tweens, transitions, cutscenes), HUD and menus, input, audio and verification. Not for choosing an engine (agent-engine:engine-selection) or importing assets into other engines (agent-engine:engine-asset-import).
---

# Phaser core

Start here for Phaser 4.2.1. Read the reference for the task.

| You are about to | Read |
| --- | --- |
| Scan every rule on one page | [phaser reference](references/phaser-reference.md) |
| Create a project or split a game into layers | [architecture](references/architecture.md) |
| Select, apply or verify version-pinned dependency corrections | [dependency patches](references/dependency-patches.md) |
| Write `new Phaser.Game(config)`, choose `pixelArt`, limit fps, wire Vite or ESM, destroy a game | [config and boot](references/config-and-boot.md) |
| Fit, resize or fullscreen the canvas, or fix blur on a high-density screen | [scale and responsive](references/scale-and-responsive.md) |
| Load, retry, progress-bar or release assets, or pick an atlas or compressed format | [loading assets](references/loading-assets.md), [failures](references/loading-failures.md) |
| Build the first level or add content; budget textures; fix a page a phone kills | [texture memory](references/texture-memory.md), [building a level](../phaser-worlds/references/building-a-level.md) |
| Boot, scenes, a global plugin, the fixed-step loop and interpolation | [scenes, loop and plugins](references/scenes-loop-and-plugins.md) |
| Hit a scene restart that leaks, double-registers or fires events twice | [scene lifecycle gotchas](references/phaser-4-scene-lifecycle-gotchas.md) |
| Subscribe to events, pass data between scenes or decide where state lives | [events and data](references/events-and-data.md) |
| Group sprites, use a Container, Layer or pool, or destroy objects | [game objects and containers](references/game-objects-and-containers.md) |
| Load agent-sprites or agent-beeps output | [asset wiring](references/asset-wiring.md) |
| Copy a name or behaviour from Phaser's own skill documents | errata: [names](references/phaser-docs-errata-names.md), [behaviour](references/phaser-docs-errata-behaviour.md) |
| Port Phaser 3 code or follow an old tutorial | [Phaser 3 to 4](references/v3-to-v4-migration.md) |

## First five minutes

1. [general] **Pin the version and say which.** `npm view phaser version` and `npm view phaser dist-tags`. As of 2026-07 the
   `latest` tag is 4.2.1; the `beta` tag is a stale 4.0.0-rc.7. Pin the exact version in `package.json`. Phaser 3 sample
   code often does not apply ([what to ignore](references/v3-to-v4-migration.md)).
2. [documented] **Read Phaser's own skills.** Phaser 4 ships about 600 KB of skill documents in `node_modules/phaser/skills`.
   They match the installed version and beat memory and web posts, except where these references test otherwise. Known-wrong
   lines are in the errata (table above).
3. [general] **Put rules in a headless layer.** Keep game state and rules in plain TypeScript that never imports Phaser, and let
   Phaser draw it ([architecture](references/architecture.md)): the game is unit-testable, saves are small and restarts safe.
4. [general] **Decide the verification up front.** Unit tests plus a Playwright suite that runs on the GPU and asserts on
   *pixels*, not on "no console errors" ([phaser-verification](../phaser-verification/SKILL.md)).

## Rules that earned their place

- [tested] **Import Phaser wherever a value is used.** The ESM build never sets `window.Phaser` (`config-esm-has-no-global`), so a
  file that uses it unimported throws `Phaser is not defined`; add a scanning test.
- [general] **Never use wall-clock or `Math.random` in rules.** Use a seeded generator and a fixed timestep, and save the
  generator's state in the snapshot: or a loaded game restarts the random stream and drifts (test: step a saved and a
  restored sim side by side).
- [tested] **Every scene restart must be leak-tested.** `scene.events`, `scene.data`, the registry and the previous start data all
  survive a restart. Restart ten times and require a listener census, textures and display objects not to grow
  ([events and data](references/events-and-data.md)).
- [tested] **Fail loudly at boot.** `parent` is an element id (`'#game'` lands in `body`), a 404 is never retried, and `complete`
  fires with failures: assert the canvas parent and gate the first scene on `totalFailed === 0` and on every requested key
  reaching its cache (a decode failure is not counted)
  ([config](references/config-and-boot.md), [loading failures](references/loading-failures.md)).
- [tested] **Content has two costs a desktop hides.** A texture costs width x height x 4 bytes whatever its file weighs: sum
  everything held, budget for the weakest device, and load per level when the game exceeds it. Nothing culls by position: file each object under a chunk as you create it. Both are
  in the "build the first level" row.
- [tested] **Integer scale is not automatic.** `FIT` ignores `zoom` and scales by 2.5; `snap` needs `min`; the canvas is not
  device-pixel aware (`NONE`, `zoom: 1 / dpr`). Test several window sizes and ratios
  ([scale](references/scale-and-responsive.md)).
- [tested] **A Container is not a Layer.** A Container draws in list order and centres its hit area; a Layer sorts by depth;
  `Group#get` hands out a dead member without reviving it ([game objects](references/game-objects-and-containers.md)).
- [general] **When a tool is missing something, fix the tool.** Capabilities the game needs from agent-sprites or agent-beeps
  belong in those tools (with a tracked backlog item), not in game workarounds.

The `[tested]` rules are reproduced by `engine-phaser-foundations.mjs` and `phaser-verification-content-cost.mjs` in
`examples/web/phaser-probes` (`node <probe> <host project>`).

## Domain skills

- [general] **Phaser is split by system, so pick the skill for the work.** Each owns its references, patches and rules.

| Work | Skill |
| --- | --- |
| Effects, WebGL, render nodes, filters, shaders, stencil, meshes, textures, context loss | [phaser-rendering](../phaser-rendering/SKILL.md) |
| Tilemaps, chunk streaming, cameras, lights, weather and particles | [phaser-worlds](../phaser-worlds/SKILL.md) |
| Arcade and Matter physics, collision, tilemap collision, pathing | [phaser-physics](../phaser-physics/SKILL.md) |
| Tweens, timelines, animations, timers, curves | [phaser-motion](../phaser-motion/SKILL.md) |
| HUD, pixel-exact canvas, bitmap text, panels, accessible controls | [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md) |
| Keyboard, pointer, gamepad, touch | [phaser-input](../phaser-input/SKILL.md) |
| Native audio, lifecycle, beeps directors | [phaser-audio](../phaser-audio/SKILL.md) |
| Real-GPU checks, profiling, frame budgets | [phaser-verification](../phaser-verification/SKILL.md) |
| Contracts and testing cost across several games | [phaser-architecture](../phaser-architecture/SKILL.md) |

## Not covered here

Engine choice: agent-engine:engine-selection. Post effects outside Phaser: agent-engine:engine-custom-shaders. Assets for
other engines: agent-engine:engine-asset-import.
