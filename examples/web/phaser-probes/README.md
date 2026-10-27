# Phaser probes

Small Playwright scripts for debugging a Phaser game on a real GPU. They expect the
game on `http://localhost:5173` (override with `--url=` or the second argument) and a global `window.__game` that holds the
`Phaser.Game` (`__game` is the only name read). Playwright comes from the host project (`npm i -D @playwright/test`).

- `shot.mjs` starts a game, optionally runs a JavaScript snippet (`--eval=...`, one line, no `//` comments), screenshots,
  and prints the WebGL renderer string, fps and console errors. The ANGLE backend follows the platform
  (`d3d11`, `metal` or `gl`).
- `probe.mjs "<expression>"` evaluates an expression inside the running game (it can use `game`) and prints the result.

They assume the game starts a world when Enter is pressed after the title scene; adapt the first lines for your own
start flow. The method they support is in `skills/phaser-verification/references/verifying-on-a-gpu.md`: read a pixel at a
tile whose data you know, then toggle layers one at a time and read it again.

`scroll-mask.mjs /absolute/path/to/host-project` is standalone: it starts its own tiny Phaser 4.2.1 scene, with no dev server or
game debug API. The host project supplies `phaser` and `@playwright/test`. Set `CHROME_CHANNEL=chrome` to use installed Chrome;
otherwise install Playwright Chromium. It requires a hardware GPU and prints its renderer string. It proves the legacy WebGL mask
failure beside native external-filter clipping, scrolling, zoom, viewport-only input and ten scene restarts. See pixel-perfect-and-ui
section 8 for the production recipe, resource policy and behaviors this focused probe does not cover.

`source-pixels.mjs /absolute/path/to/host-project` is also standalone. It measures six distinct texels at art scale 2 and
camera zooms 3, 3.5, 4, 4.5 and 7.5, including fractional follow coordinates, at DPR 1 and 1.5. Each source texel must occupy
the exact integer device-pixel rectangle. It also compares fractional source-scale-1 UI zoom with its integer correction.
It prints the actual hardware renderer and all block measurements; it does not test a game's complete artwork, pointer targets,
mobile browser, or sustained performance. Use the same host dependencies and `CHROME_CHANNEL` option as the scroll probe.

## Domain-skill probes (Phaser 4.2.1)

Each Phaser domain skill cites the probes that reproduce its `[tested]` claims. They are standalone: each starts its own tiny
Phaser scene in a throwaway page, so the host project only provides `phaser` (4.2.1) and `@playwright/test` (or `playwright-core`).
Run one with `node <probe>.mjs /absolute/path/to/host-project`. They print their checks and exit non-zero when a behaviour
changed, so a Phaser upgrade names the reference to update. They are a manual lane, not part of `node scripts/check.mjs`. Unless a
probe says it needs a hardware GPU, it runs on headless Chromium with a software rasteriser, which is enough for logic, counts and
flat-colour pixels but not for GPU correctness or speed. The `[tested]` label means "reproduced by one of these".

| Skill | Probes |
| --- | --- |
| `engine-phaser` | `engine-phaser-foundations.mjs`: config and boot, scale, loader, events and data, game objects, Phaser 3 leftovers (40 checks) |
| `phaser-rendering` | `phaser-rendering-render-graph.mjs`, `-filters.mjs`, `-stencil.mjs`, `-mesh-and-gpu-layer.mjs`, `-textures-and-shaders.mjs`, `-webgl2-context.mjs`, sharing `phaser-rendering-harness.mjs` (not run alone); also runs on a hardware GPU with `PROBE_GL=hardware` |
| `phaser-worlds` | `phaser-worlds-cameras.mjs`, `-lights.mjs`, `-particles.mjs`, `-tilemaps.mjs`, `-layers.mjs`, sharing `phaser-worlds-lib.mjs` (not run alone) |
| `phaser-physics` | `phaser-physics-arcade.mjs`, `-matter.mjs`, `-tilemap.mjs`, `-paths.mjs` |
| `phaser-motion` | `phaser-motion-clocks.mjs`: which clock drives tweens, timers and animations (optionally also against an extracted 4.2.0 package) |
| `phaser-pixel-ui` | `phaser-pixel-ui-text.mjs`, `phaser-pixel-ui-panels.mjs` |
| `phaser-input` | `phaser-input-keyboard.mjs`, `-pointer.mjs`, `-gamepad.mjs` (a fake `navigator.getGamepads`, no physical controller) |
| `phaser-audio` | `phaser-audio-manager.mjs`, `phaser-audio-sounds.mjs` |
| `phaser-verification` | `phaser-verification-driving.mjs` (clocks, HEADLESS and its missing global plugins, seeds), `-pixels.mjs`, `-leaks.mjs`, `-renderer.mjs` |

The pure-logic helpers have ordinary Node tests in the merge lane: `tests/phaser-physics-grid-sweep.test.mjs`,
`tests/phaser-pixel-ui-focus.test.mjs`, `tests/engine-phaser-migration-patterns.test.mjs` and `tests/phaser-docs-errata.test.mjs`.

`phaser-docs-errata.mjs /absolute/path/to/host-project` is also standalone and needs no browser: after a Phaser upgrade it checks that each needle in the `engine-phaser` errata tables is still in the installed package's own documents, prints present or ABSENT per row and exits 1 when any row needs a re-check. `errata-rows.mjs` reads those tables for it and for the merge-lane test.
