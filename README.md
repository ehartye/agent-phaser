# agent-phaser

A Claude Code plugin of skills for building, debugging and proving Phaser 4 games from a coding agent. It starts a project
on a pinned Phaser version, then covers the WebGL renderer and its filters, worlds bigger than the screen, physics, motion,
pixel-exact UI, input, audio, and architecture shared across games. The claims in the skills are backed by browser probes,
install-time patch scripts, a Playwright test harness template and a handful of Node tests, and each claim bullet says
which kind of evidence it rests on (`[tested]`, `[documented]` or `[general]`).

It pairs with assets from [agent-sprites](https://github.com/ehartye/agent-sprites) (pixel sprite atlases and paired
normal maps), [agent-meshes](https://github.com/ehartye/agent-meshes) (rigged GLB models) and
[agent-beeps](https://github.com/ehartye/agent-beeps) (procedural sounds and music): the skills say how a Phaser game loads
and plays what those plugins export.

Choosing an engine, and importing assets into Unity, Godot or a non-Phaser web stack, are in the
[agent-engine](https://github.com/ehartye/agent-engine) plugin: use `agent-engine:engine-selection` to decide whether
Phaser is the right tool and `agent-engine:engine-asset-import` for the other targets. Unreal and UEFN are in
[agent-unreal](https://github.com/ehartye/agent-unreal). The plugins install separately and none requires another.

## Status

Early (0.1.3). Ten skills. This is the first release of the Phaser skills as their own plugin; they were developed in
agent-engine up to 0.33.0, and their history is kept here. Phaser 4.2.1 is the pinned version. Nothing in the skills is
specific to one game.

## Skills

| Skill | Job |
|---|---|
| `engine-phaser` | Start and structure a Phaser 4 game: pin the version, game config, scale, asset loading, scenes and the fixed-step loop, events and data, game objects and containers, a headless sim with Phaser as the view, and a Phaser 3 to 4 migration checklist. The entry point to the domain skills below. |
| `phaser-rendering` | Drive the Phaser 4.2 WebGL renderer: render nodes and draw-call counting, filters (including the pixel-art Blocky, Pixelate, Quantize and GradientMap), Stencil and CustomContext, Mesh2D, SpriteGPULayer, render textures, tint modes, shaders, WebGL 1 versus 2, and the numbered context-loss and destruction gotchas with install-time patches. |
| `phaser-worlds` | Build a Phaser 4 world bigger than the screen: cameras and zoom, dynamic and cone lights, normal-mapped sprites from a paired atlas, particles, Tiled and procedural tilemaps with CPU versus GPU layers, chunk streaming, Layer versus Container, day and night. |
| `phaser-physics` | Choose and drive Phaser physics: Arcade versus Matter versus your own headless collision, bodies and colliders, tile collision, tunnelling limits, deterministic stepping, paths and platforms. Includes a tested grid sweep helper. |
| `phaser-motion` | Time and motion in Phaser 4: tweens and chains, sprite animations, scene transitions and Timeline cutscenes, which clock drives what (and why a hand-stepped loop does not move tweens), delta smoothing, curves and followers, and motion craft for pixel games. |
| `phaser-pixel-ui` | Pixel-exact canvas and UI: integer footprints, text and bitmap fonts, NineSlice and tiled panels, DOM overlays and forms, layout, focus and controller navigation (with a tested focus helper), clipped scrolling and the accessibility bridge. |
| `phaser-input` | Keyboard, pointer and mouse, gamepad and touch in Phaser 4: one input owner, scene routing, captures, the gamepad API, replay in tests, and the independent held-input and lifecycle patches. |
| `phaser-audio` | Sound in Phaser 4: the sound manager and first-gesture unlock, markers and audio sprites, loops across scene restarts, spatial and mix, agent-beeps variants and song sections, testing audio without ears, with the decode and visibility patches. |
| `phaser-verification` | Prove a Phaser change: debugging and silent failures, deterministic test driving, pixel assertions, scene-restart leak tests, real-GPU Playwright and CI, performance and Chrome frame-budget profiling. |
| `phaser-architecture` | Coordinate shared contracts, themed dialogs and extensions, playbot evidence and testing and publication costs across Phaser games and owned tools. Portable guidance with explicit existing and planned boundaries; adds no shared UI, playbot runtime or cloud service. |

The [Phaser WebGL reference](skills/phaser-rendering/references/webgl-backends.md) distinguishes official WebGL 2 support from
4.2.1's default WebGL 1 context, covers ES3 custom-shader setup and keeps Phaser AE's separate API clear. The referenced
GL1/GL2 probe is bounded pixel and API evidence, not a full sample-scene or performance claim.

## Dependency corrections

The [selection reference](skills/engine-phaser/references/dependency-patches.md) maps every shipped Phaser 4.2.1 correction
to its feature, symptom, patch ID, fixed composition order, verification command and upstream removal condition. Select IDs explicitly:

```sh
node examples/node/patch-phaser.mjs /path/to/game/node_modules/phaser --patches gamepad-held-input,gamepad-lifecycle
node examples/node/patch-phaser.mjs /path/to/game/node_modules/phaser --patches gamepad-held-input,gamepad-lifecycle --verify
```

Apply stages and validates the full selected composition before writing installed files. Verify uses temporary copies, leaves
the supplied dependency unchanged, and exits nonzero for uncorrected or unknown input. There is no automatic selection or download.
Run from this checkout or use an absolute entrypoint path, retaining the shipped layout for its installer imports. Existing individual
installers remain available. Apply after installation and before bundler optimization; recreate an existing optimized cache afterward.

## Probes and harness

`examples/web/phaser-probes/` holds the browser probes (`run-all.mjs` runs them against a host project that supplies Phaser
and Playwright; the default software lane and the `--hardware` lane are described in its README), `examples/web/harness/`
is a runnable Playwright test-harness template for a Phaser game, and `examples/web/profiling/` holds the Chrome
frame-budget probe. These are a manual lane: the merge check starts no browser.

## Checking the skills

Run `node scripts/check.mjs` locally before pushing or merging (Node 20.11 or newer, no dependency install). It runs the
Node tests in `scripts/`, `tests/` and `examples/`, a strict lint of all ten skills (frontmatter, relative links, the
"You are about to / Read" table, size budgets, placeholders, evidence labels on every claim and a labelled bullet in every
section), a report of each skill's listing length and shared trigger words, and a scan for invisible Unicode. It exits
non-zero on any failure and works from any current directory when invoked by its path. `scripts/README.md` lists the pieces.

This project is in **dev** mode: local merge checks are the gate. CI (`.github/workflows/lint-skills.yml`) is one
non-required Linux observer on ready pull requests, with path filters, cancellation of superseded runs and a five-minute job
timeout. It also runs weekly, manually and on `v*` release tags. Merging does not start a duplicate run on `main`; draft pull
requests skip the job until ready for review. Structural checks do not establish that a skill improves an agent's work, and
browser or GPU acceptance is a separate, explicitly set up run.

## Install

Add this repository as a marketplace and install from it:

```text
/plugin marketplace add ehartye/agent-phaser
/plugin install agent-phaser@agent-phaser
```

A listing in the shared plugin marketplace follows the first release.

## Requirements

The skills need nothing installed themselves. Running the probes or the harness needs Node, Playwright and a host project
with Phaser 4.2.1; the hardware lane needs a machine with a GPU.

## License

MIT
