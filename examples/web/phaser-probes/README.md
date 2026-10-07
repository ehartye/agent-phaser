# Phaser probes

Small Playwright scripts from the Fallow Valley project for debugging a Phaser game on a real GPU. They expect the
game on `http://localhost:5173` (override with `--url=` or the second argument) and a global `window.__game` that holds the
`Phaser.Game` (`__fallow` also works). Playwright comes from the host project (`npm i -D @playwright/test`).

- `shot.mjs` starts a game, optionally runs a JavaScript snippet (`--eval=...`, one line, no `//` comments), screenshots,
  and prints the WebGL renderer string, fps and console errors. Launch flags select the GPU on Windows
  (`--use-angle=d3d11`); change them for other platforms.
- `probe.mjs "<expression>"` evaluates an expression inside the running game (it can use `game`) and prints the result.

They assume the game starts a world when Enter is pressed after the title scene; adapt the first lines for your own
start flow. The method they support is in `skills/engine-phaser/references/verifying-on-a-gpu.md`: read a pixel at a
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
