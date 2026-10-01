# Web sample scene scripts

Phaser 3.90.0 and three.js 0.186.1 builds of the [sample scene](../../docs/sample-scene.md), plus a headless Chromium
verifier. three.js churns its API often (0.186 deprecated `THREE.Clock`), so the versions are pinned in `package.json`.

- `phaser/` the campfire and courier through Phaser's Aseprite loader, audio through the agent-beeps player. 2D only.
- `three/` the 3D fox GLB with its `walk` clip, the campfire and courier as billboard flipbooks, the same audio.
- `serve.mjs` a no-dependency static server for the workspace root. `verify.mjs` drives a page and writes a report.

The pages expect the scenes workspace layout used by the Unreal scripts: `assets/meshes/fox.glb`,
`assets/sprites/*.png|atlas.json`, `assets/audio/*.wav` with `index.json`, and `web/` holding these files. In that workspace:

```text
cd web && npm install
# from assets/beeps (an agent-beeps project):
beeps bundle ../audio                     # writes assets/audio/index.json from the sidecars
beeps player export ../../web/vendor      # vendors the browser player
node web/serve.mjs                        # then open /web/phaser/index.html or /web/three/index.html
node web/verify.mjs phaser                # or three: writes web/results/*-report.json and screenshots
```

`verify.mjs` takes Playwright from `PLAYWRIGHT_DIR` (default: a sibling agent-beeps checkout) and launches Chromium with
`--use-angle=d3d11 --ignore-gpu-blocklist`; it reports the WebGL renderer string so you can see whether it ran on the GPU
or in software. It loads the page, records console errors and failed requests, samples animation state twice,
screenshots, clicks (the gesture that unlocks audio), then triggers the pickup 12 times and checks the variants.
