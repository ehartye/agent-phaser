# Web sample scene scripts

A Phaser 4.2.1 build of a small sample scene (a campfire, a courier and audio) plus a headless Chromium verifier. The Phaser version is pinned in `package.json`.

- `phaser/` the campfire and courier through Phaser's Aseprite loader, audio through the agent-beeps player. 2D only.
- `../campfire/` the campfire atlas the page loads: `dist/campfire.png` and `dist/campfire.atlas.json`, built with agent-sprites (see its README).
- `ci/pages-audio.yml` a GitHub Pages workflow template for a game whose agent-beeps audio is fetched by lock and verified, never rendered in CI (see the ci-for-generated-assets reference of agent-engine:engine-asset-import).
- `harness/` a runnable Phaser 4.2.1 test-harness template: debug API, manual frame loop, condition waits (`until`, `settle`, `elapsed`, `framesUntil`), a no-sleeps guard, a GPU smoke spec with `@gpu` tagging, and a CI workflow with a gating SwiftShader job and an advisory Firefox/WebKit job (see its README; tested on Chromium with a real GPU and SwiftShader, Firefox and WebKit untested).
- `phaser-probes/` the browser probes behind the skills' `[tested]` labels, and `profiling/` the frame-budget tools.
- `serve.mjs` a no-dependency static server for the workspace root. `verify.mjs` drives the Phaser page and writes a report.

The page expects a scenes workspace with this layout: `assets/sprites/*.png|atlas.json` (copy the campfire files from `../campfire/dist/` and name them `campfire.png` and `campfire.atlas.json`, next to a courier atlas), `assets/audio/*.wav` with `index.json`, and `web/` holding these files. In that workspace:

```text
cd web && npm install
# from assets/beeps (an agent-beeps project):
beeps bundle ../audio                     # writes assets/audio/index.json from the sidecars
beeps player export ../../web/vendor      # vendors the browser player
node web/serve.mjs                        # then open /web/phaser/index.html
node web/verify.mjs phaser                # writes web/results/phaser-report.json and screenshots
```

`verify.mjs` takes Playwright from `npm i -D playwright` (or `PLAYWRIGHT_DIR`, an installed playwright folder) and launches Chromium with
`--use-angle=<d3d11|metal|gl by platform> --ignore-gpu-blocklist --force_high_performance_gpu` (the third flag picks the discrete GPU
on a laptop with two and is harmless elsewhere). It prints the WebGL renderer string and fails when it is a software renderer (SwiftShader,
llvmpipe) unless you pass `--allow-software`. The renderer string comes from the WebGL context the page renders with, which the page exposes as `window.__gl` (it returns `game.renderer.gl`, which is a WebGL 1 context by default); a fresh canvas is the fallback only for a page that exposes none, and the report says which context was classified. It loads the page, records console errors and failed requests, samples
animation state twice, screenshots, checks that audio is locked and nothing played, makes one real click (the gesture
that unlocks audio), checks that audio runs, then triggers the pickup 12 times and checks the variants. It launches
without `--autoplay-policy=no-user-gesture-required`, because that flag lets audio run without the gesture and hides
the gate; `--autoplay` adds it back for debugging. It exits 1 when a check fails. `verify-checks.mjs` holds the flags
and checks; `node --test web/verify-checks.test.mjs` tests them without a browser.
