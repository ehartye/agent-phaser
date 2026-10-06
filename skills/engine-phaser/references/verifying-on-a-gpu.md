# Verifying a Phaser game on a real GPU

Software WebGL hides performance problems and some correctness problems, and "no console errors" passes on a blank
screen. Verify on the GPU and assert on pixels.

## Playwright configuration

```ts
// playwright.config.ts
export default defineConfig({
  testDir: 'tests/browser',
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] },   // Windows; use the platform equivalent elsewhere
  },
  webServer: { command: 'npx vite --port 5199 --strictPort', url: 'http://localhost:5199', reuseExistingServer: true },
});
```

Expose the game for tests with `globalThis.__game = game`. Assert that the renderer string is not software:

```ts
const gl = game.renderer.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info');
expect(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))).not.toMatch(/swiftshader|llvmpipe|software/i);
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

See `examples/web/phaser-probes` for generic versions.

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

example: `tools/mutation-input.mjs`, `tests/visual/scenes.spec.ts`, `tests/perf/budget.spec.ts`, `playwright.config.ts`.
