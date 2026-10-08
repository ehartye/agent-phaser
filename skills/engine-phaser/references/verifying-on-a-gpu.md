# Verifying a Phaser game on a real GPU

Software WebGL hides performance problems and some correctness problems, and "no console errors" passes on a blank
screen. Verify on the GPU and assert on pixels.

## Playwright configuration

```ts
// playwright.config.ts
export default defineConfig({
  testDir: 'tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] },   // Windows; use the platform equivalent elsewhere
  },
  webServer: { command: 'npx vite --config vite.evidence.config.mjs', url: 'http://127.0.0.1:5199', reuseExistingServer: false },
});
```

On a laptop with two GPUs the first two flags are not enough. [tested] On Windows 11 with an Intel integrated GPU and an
NVIDIA RTX 5070 Ti Laptop GPU (Playwright 1.63.0, Chromium 153): no flags rendered on SwiftShader, `--use-angle=d3d11
--ignore-gpu-blocklist` on the Intel GPU, and adding `--force_high_performance_gpu` on the NVIDIA GPU (Sector Run, and
repeated with `examples/web/verify.mjs`). Print the renderer string on every run and fail on software (below), since software WebGL raises
no error.

For frozen acceptance, own the server, source root, configuration and cache identity. Choose a free strict port and a fresh cache directory;
do not attach to an unidentified existing server. Keep full raw server stdout/stderr from before process spawn, not only a tail sample.
Record the PID, pinned Vite version/module hashes, source/config hashes, origin and actual served optimized dependency URL/response hash
alongside its cache metadata and file hash. A source freeze alone does not identify the optimized code served to the browser.

### Keep frozen evidence outside Vite's live inputs

Prefer source snapshots, logs and trace resources outside the Vite root. Git-ignore is not watcher isolation; a unique `cacheDir` only
isolates that cache, not evidence elsewhere. Vite 8.3.3's [watcher defaults](https://raw.githubusercontent.com/vitejs/vite/v8.3.3/docs/config/server-options.md)
omit `.local`. A watched copied `tsconfig.json` forces a full reload, and captured HTML can emit reloads. This can reset game/audio state
without changing product source. The separate [HTML dependency scan](https://raw.githubusercontent.com/vitejs/vite/v8.3.3/docs/config/dep-optimization-options.md)
also needs exact real entry points; watcher ignores do not set scanner entries.

If evidence must live in `.local`, reserve that subtree for evidence/tooling and explicitly exclude it. Extend the app's config instead
of replacing its plugins or aliases; this example assumes the existing config is `vite.config.mjs`. Replace `index.html` with every real
app HTML entry (for example, `['index.html', 'phaser.html']`), choose an unused port and change the run ID for each frozen acceptance:

```js
// vite.evidence.config.mjs: keep the app's plugins, aliases and other settings.
import {defineConfig,mergeConfig,normalizePath} from 'vite';
import {resolve} from 'node:path';
import appConfig from './vite.config.mjs';

export default defineConfig(async env=>{
  const app=await (typeof appConfig==='function'?appConfig(env):appConfig);
  const root=resolve(app.root??'.');
  const evidence=normalizePath(resolve(root,'.local'));
  const config=mergeConfig(app,{
    cacheDir:resolve(root,'../.vite-evidence-cache/run-20261007-a'), // Fresh run ID.
    server:{host:'127.0.0.1',port:5199,strictPort:true,watch:{ignored:[file=>{
      const path=normalizePath(file);
      return path===evidence||path.startsWith(evidence+'/');
    }]}}
  });
  // Replace after merging: mergeConfig concatenates arrays, including entries.
  config.optimizeDeps={...config.optimizeDeps,entries:['index.html']}; // All real app HTML entries.
  return config;
});
```

Keep native HMR and dependency optimization enabled for actual app source. Before freezing, verify the configuration in a small isolated
fixture using the installed Vite: copied `.local` tsconfig/trace-HTML writes must produce no watcher/HMR events during a bounded observation,
while an actual app HTML/source edit still produces native reload/update events. Check native cache metadata for app dependencies and the
absence of snapshot-only dependencies, then fetch the app's actual optimized import. Close owned sockets, watchers and server and verify
the PID/port cleanup. Do not mutate frozen product source for this positive control.

A Windows Node 24/Vite 8.3.3 fixture verified these behaviors with native WebSocket events and one-second negative observation windows.
Its scan proof used visible snapshot HTML; hidden `.local` HTML was not a default scan entry there. This proves the configuration boundary,
not the historical cause of every game failure or a fresh Phaser/audio/GPU pass. Recheck the bounded controls after a Vite upgrade.

Expose the game for tests with `globalThis.__game = game`. Assert that the renderer string is not software:

```ts
const gl = game.renderer.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info');
expect(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))).not.toMatch(/swiftshader|llvmpipe|software|basic render/i);
```

## What to assert

1. **A clean console** (errors and warnings) and **no page errors**.
2. **Pixel colours, not "not black".** Teleport the player to a place whose terrain you know (a ruins district with dark
   asphalt, a lake) and assert the share of pixels in a colour range. A "not black" test passed while dust covered the
   whole terrain.
3. **Every visible chunk renders**, with a camera parked on a chunk corner so four chunks are visible.
4. **Pooling and streaming**: walk for several seconds and assert the number of containers or views stays bounded.
5. **Entity views appear and are released** when a creature leaves the camera.
6. **Frame rate and renderer** are recorded, not asserted tightly.

## Prove the test by mutation

For each regression test, re-introduce the bug (for example make an overlay layer a GPU layer again), run the test,
confirm it fails with a clear number (the dark-pixel ratio went from over 0.08 to 0), and restore the fix.

## Debugging harness (small scripts worth keeping)

- A script that starts the game, optionally runs an expression, screenshots, and prints the renderer string, fps and
  console errors.
- A script that teleports the player to a named place (seep, vault, a biome) and screenshots it. Chunks are generated on
  demand, so this reaches far terrain in seconds.
- A **pixel check** that finds a tile whose data is known, reads the screenshot pixel there, then toggles layers one at a
  time and reads it again. That is what found the overlay bug: baseline dust, ground plus overlay dust, ground plus
  floor clay.
- Pass JavaScript through `page.evaluate` as one line without `//` comments (joining lines turns the rest into a comment).

See `examples/web/phaser-probes` for generic versions. For a whole runnable harness (debug API, manual loop, condition waits, no-sleeps guard, GPU smoke spec, CI workflow) copy `examples/web/harness`.

## Gotchas in the harness itself

- Teleporting a long way and screenshotting after a fixed wait can be flaky on the first frame; wait for chunks to bind.
- At zoom 3, tile (8, 8) is 384 px from the origin; an edit you cannot see may simply be off screen.
- Day and night multiply tints change pixel colours; set the clock to noon before sampling colours.

## Read pixels inside the page: `renderer.snapshotPixel`

A Playwright screenshot is not the only way to read the screen. In the page, `game.renderer.snapshotPixel(x, y, cb)` queues a read that is
fulfilled at the end of the next rendered frame, so a probe can build a tiny object, run a frame and read a colour in one script:

```ts
const px = (wx: number, wy: number) => new Promise<{ red: number; green: number; blue: number }>((res) => {
  game.renderer.snapshotPixel(Math.round((wx - cam.worldView.x) * cam.zoom), Math.round((wy - cam.worldView.y) * cam.zoom), res);
  stepFrame();                                     // in a manual loop: game.step(t, 0)
});
```

Each Phaser behaviour claim in these references can be reduced to such a probe. Two examples that decide real designs (both pass on 4.2.1;
if one starts failing after an upgrade, the workaround it justifies can be deleted):

- GPU layer at `x = 60` draws at `120`: build a 4x4 GPU layer of a known tile at `(60, 0)`, read a pixel at world x 70 (unchanged) and x 170 (now
  the tile colour); put the same layer at `(0, 0)` inside a container at `(60, 0)` and the colours swap to the correct ones.
- An "empty" (`-1`) tile in a GPU layer is the tileset's top-left pixel: an all-empty layer over a sheet whose first pixel is opaque paints that
  colour; over a sheet whose first cell is transparent it paints nothing.

example: fallow-valley-next `tests/browser/phaser-evidence.spec.ts`.

## Drive the real loop by hand, deterministically

`game.loop.sleep()` stops `requestAnimationFrame` and keeps the callback; `game.step(time, delta)` then runs one whole frame (pre-step, every
scene update, render) with the clock you give it, with no delta smoothing; `game.loop.wake()` gives it back. With a virtual clock, tweens, the
scene `time` clock, particles and the fixed-step stepper all follow it, so tests need no `waitForTimeout`.

- Keys and pointer events are queued by the DOM and consumed at the next step: `keydown` does nothing until a frame runs. A held key re-sends
  `move` each frame, so hold, run a zero-delta frame, then step.
- A tight synchronous `while (!ready) game.step()` starves the loader (asset XHRs finish on the event loop). Yield between frames.
- Expose one typed debug object (`__game.debug`) that the panel, the browser tests, the command-line tools and demo mode all use:
  `frames(n, { dt })`, `ticks(n)`, `tp(place)`, `time(h)`, `weather(w)`, `layer(name, on)`, `state()`, `sample()` (fps, CPU ms, draw calls),
  `hash()`, `record()`/`stop()`/`replay(rec)`. Gate it: always on the dev server, on a production build only when the URL asks
  (`?debug=1`), loaded through a dynamic `import()` so it is a separate chunk.
- `evaluate` serialises a function: it cannot close over variables, and a TypeScript helper called inside it does not exist in the page.
  Never return a Phaser object from it.

example: `src/game/debug/*`, `tests/harness/*`, `tools/fv.mjs`, `docs/HARNESS.md`.

## Waiting: conditions, frames and page time, never sleeps

`page.waitForTimeout` is a bet about today's machine speed: it broke when a bigger atlas slowed the first boot, hides what is being waited for inside a number, and
on a software-GL runner (about one frame a second) it is wrong by an order of magnitude. Replace it, in this order:

| Waiting for | Use |
| --- | --- |
| a scene, modal or object you can name | `until(page, fn, arg)`: `waitForFunction` with `polling: 'raf'` |
| a genuine animation (fade, tween, camera ease) | `settle(page, frames)`: counts display frames, so a slow machine stretches the wait |
| the sim to have run | ticks of the sim's own clock, capped when it is paused |
| a duration that is the thing under test | `elapsed(page, ms)`: `performance.now()` polled in the page. Never "after 90 frames" on software GL |
| a condition while the loop is manual | `framesUntil`: run frames inside the page until it holds, yielding to the event loop between batches |

Add a **no-sleeps test** (scan the specs for `waitForTimeout` and in-page `setTimeout` promises; allow only a perf sample; make it prove it can fail). Specs that
`goto` then sleep then press Enter fail under load with "no game in progress": start the game through the debug API once the title scene is active.
Code: `examples/web/harness/tests/wait.mjs`, `no-sleeps.test.mjs`.

## Determinism proofs and regression tests worth having

- **Record and replay**: the sim is `f(seed, command log)`. A recording is the seed, commands with their tick and a state hash every 100 ticks;
  replaying on a fresh sim names the first tick and state part that differ. Record camera-driven chunk generation too (it spawns creatures).
  Save the RNG state in snapshots and compare saved and restored sims side by side.
- **Visual regression**: render a few dozen canonical scenes at a fixed size with the interface hidden and compare with a perceptual tolerance
  (`maxDiffPixelRatio`, colour `threshold`); one `snapshotPathTemplate` without `{platform}` if one GPU makes the baselines. Tag exact-pixel
  tests `@gpu` so a software-GL CI can skip them.
- **Perf budgets** in a separate project that runs after the others on one worker.
- **Two workers by default.** Eight Chromiums each loading the dev server and a WebGL context exhaust memory and push first load past any fixed
  sleep. Wait on state (the title scene being active), never on time; one retry locally, reported as flaky.
- **Mutation scripts for pure logic**: a script holds `[name, file, exact text, replacement]` rows, rewrites one line, runs the unit tests, requires
  failure, and always restores the file. A survivor means the tests do not guard that line.

Run the suite twice: **gating** on SwiftShader (`@gpu` tests skipped) and the real-GPU suite locally before merge. A CI job for Firefox and WebKit needs `xvfb-run` with
`LIBGL_ALWAYS_SOFTWARE=1` and a PulseAudio null sink, and stays advisory until it has been green for a while ([CI traps](../../engine-asset-import/references/ci-for-generated-assets.md)); template `examples/web/harness/ci/smoke.yml`.

example: `tools/mutation-input.mjs`, `tests/visual/scenes.spec.ts`, `tests/perf/budget.spec.ts`, `playwright.config.ts`.

## A debug API, a manual frame loop and a page object (what replaces the sleeps)

The probes above each repeated "start, wait 600 ms, press Enter, wait 1200 ms". Under parallel workers the title was not up yet, Enter went nowhere, and the next
line failed with "no game in progress". Build the harness once instead (Fallow Valley: `docs/HARNESS.md`, `src/game/debug`, `tests/harness`):

- **One typed debug object on the page** (`__game.debug`), loaded only in dev or when the URL asks (`?debug=1`, `?demo=name`) through a dynamic `import()` so a production
  build carries it as a separate chunk. It starts a world (`start({ seed, hour, weather, at, give, god })` once the title scene is active, never by key press), teleports to
  named places (biome interiors found on the climate field, points of interest, camps, bosses, a vault's rooms), sets the clock and pins weather, gives items, spawns, pauses,
  steps and scales time, toggles render layers, inspects the tile under the cursor, hashes the sim, snapshots, records and replays.
- **A manual frame loop.** `game.loop.sleep()` then `game.step(virtualTime, dt)`: tests and capture advance by ticks and frames, not wall time. Yield to the event loop between
  frames while waiting for scenes (asset loads finish there; a synchronous loop never lets `preload` complete). Keys are consumed at the next frame.
- **A page object and fixture** that fails every test on a console error or warning, exposes `start`, `step(ticks)`, `frames`, `screenshotWorld()` (interface hidden),
  pixel probes (`at`, `fraction`, `meanLum`), and `evalSim/evalDebug/evalWorld` wrappers (functions are serialised: pass data as an argument).
- **Visual regression with `toHaveScreenshot`**: about twenty canonical scenes (biomes by time of day and weather), a perceptual tolerance, one baseline set, an update
  command. Tag GPU-only tests (`@gpu`) so a SwiftShader CI can run the rest as a smoke.
- **Determinism**: hash the whole sim state (snapshot plus RNG words) and record inputs with periodic hashes. If generation spawns creatures and the camera drives
  generation, record the chunks the view generated or the replay diverges.
- **Workers**: eight Chromium workers each with a WebGL context can exhaust memory; default to two, retry once, and report flaky tests rather than hiding them.
