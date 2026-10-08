# Phaser 4 test harness (runnable template)

A small, working version of the harness Fallow Valley grew (`docs/HARNESS.md` there), cut down to the parts every Phaser game wants. The method is
in [verifying on a real GPU](../../../skills/engine-phaser/references/verifying-on-a-gpu.md); this folder is the code. Replace `game.mjs` with your
game and keep the three `HARNESS` hooks.

| File | What it is |
| --- | --- |
| `debug.mjs` | The **debug API**: one object on `globalThis.__game.debug` with `manual()`, `frames(n, {dt})`, `pixel(x, y)`, `renderer()`, `state()`. Gated: dev host or `?debug=1`. Grow it with `tp`, `time`, `hash`, `record`. |
| `tests/wait.mjs` | **Condition waits**: `until`, `settle`, `elapsed`, `framesUntil`. Nothing sleeps. |
| `tests/fixtures.mjs` | The `test` to import: opens the game, waits for readiness, **fails on any console error, warning or page error**, skips `@gpu` tests when `SOFTWARE_GL=1`. |
| `tests/smoke.spec.mjs` | The **GPU smoke spec**: renderer string, deterministic frames, pixel colours at known places. |
| `tests/no-sleeps.test.mjs` | The **no-sleeps guard** (`node --test`, no browser): fails on `waitForTimeout` or a timer promise in any spec. It tests itself. |
| `playwright.config.mjs` | Real-GPU ANGLE flags by platform, SwiftShader when `SOFTWARE_GL=1`, **two workers**, one retry locally (two in CI) and flaky tests reported. |
| `ci/smoke.yml` | A workflow with a **gating** SwiftShader Chromium job and an **advisory** Firefox/WebKit job (xvfb, `LIBGL_ALWAYS_SOFTWARE`, PulseAudio null sink). |

```text
npm install
npx playwright install chromium        # firefox webkit for --project=firefox/webkit
npm test                               # real GPU; prints the renderer string
SOFTWARE_GL=1 npm test                 # what CI runs: @gpu tests skipped
npm run test:guard                     # the no-sleeps guard alone
```

## Rules the template enforces

- **Wait on state, frames or page time, never a sleep.** `until` for something you can name, `settle` for a real animation, `elapsed` for a duration that is the
  thing under test, `framesUntil` when the loop is manual. A sleep is a build failure.
- **A manual frame loop** (`game.loop.sleep()` then `game.step(time, dt)` on a virtual clock) makes tests and captures deterministic. Keys and pointer events are
  consumed at the next step. Yield to the event loop between batches while waiting for loads; a tight synchronous loop starves the loader.
- **Assert the renderer, not just the absence of errors.** Software WebGL raises nothing. `@gpu` tests need hardware; the rest are the CI smoke.
- **Pixels, not "not black".** Known colour, known place, via `renderer.snapshotPixel` after a rendered frame.
- **`page.evaluate` serialises a function.** It cannot close over variables, and a helper from the spec does not exist in the page. Pass data as the argument and
  return plain data, never a Phaser object.
- **Two workers by default.** Eight Chromiums each loading the page and a WebGL context exhaust memory.

Prove a new test by mutation: break the thing it guards (move the block, change a colour in `game.mjs`) and watch it fail.
