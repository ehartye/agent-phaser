# Web sample scene scripts

Phaser 3.90.0 and three.js 0.186.1 builds of the [sample scene](../../docs/sample-scene.md), plus a headless Chromium
verifier. three.js churns its API often (0.186 deprecated `THREE.Clock`), so the versions are pinned in `package.json`.

- `phaser/` the campfire and courier through Phaser's Aseprite loader, audio through the agent-beeps player. 2D only.
- `three/` the 3D fox GLB with its `walk` clip, the campfire and courier as billboard flipbooks, the same audio.
- `ci/pages-audio.yml` a GitHub Pages workflow template for a game whose agent-beeps audio is fetched by lock and verified, never rendered in CI (see `skills/engine-asset-import/references/ci-for-generated-assets.md`).
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
`--use-angle=d3d11 --ignore-gpu-blocklist --force_high_performance_gpu` (Windows; the third flag picks the discrete GPU
on a laptop with two). It prints the WebGL renderer string and fails when it is a software renderer (SwiftShader,
llvmpipe) unless you pass `--allow-software`. It loads the page, records console errors and failed requests, samples
animation state twice, screenshots, checks that audio is locked and nothing played, makes one real click (the gesture
that unlocks audio), checks that audio runs, then triggers the pickup 12 times and checks the variants. It launches
without `--autoplay-policy=no-user-gesture-required`, because that flag lets audio run without the gesture and hides
the gate; `--autoplay` adds it back for debugging. It exits 1 when a check fails. `verify-checks.mjs` holds the flags
and checks; `node --test web/verify-checks.test.mjs` tests them without a browser.
