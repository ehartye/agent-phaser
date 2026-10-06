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
