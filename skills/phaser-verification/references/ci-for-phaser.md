# CI for a Phaser 4 game

Read this before you add browser tests to a pipeline, or when a test passes on CI and fails on your machine. A runner has no GPU and no sound card, and the default Chromium that Playwright launches is not the one you debug in. This page adds what the [harness workflow](../../../examples/web/harness/ci/smoke.yml) and the ci-for-generated-assets reference of agent-engine:engine-asset-import do not cover: renderer selection, WebGL failure modes and what each tier can prove. Backed by [`phaser-verification-renderer.mjs`](../../../examples/web/phaser-probes/phaser-verification-renderer.mjs).

## What each tier proves

| Tier | Runs on | Proves | Cannot prove |
| --- | --- | --- | --- |
| Rules in a Phaser-free sim, `node --test` | any runner, seconds | scoring, AI, saves, determinism | that anything draws |
| Phaser `HEADLESS` or jsdom | any runner, seconds | scene wiring, physics, timers | pixels, WebGL, audio |
| Browser smoke on software WebGL | a Linux runner | boots, steps, draws known colours, clean console, no leaks | frame time, GPU-only shaders |
| Real-GPU suite and baselines | your machine, before merge | exact pixels, frame budget | other devices |

- [general] Gate merges on the first three. Keep the last local, and say so in the PR. A pipeline that runs two of nineteen browser specs hides regressions: list the smoke set on purpose and include the scene-restart leak spec ([leaks and lifecycle](leaks-and-lifecycle-tests.md)).

## Which renderer you actually get

| Playwright launch | Renderer on the machine tested | Use it for |
| --- | --- | --- |
| `chromium.launch()` (the headless shell) | software (SwiftShader) | the CI default; reproducible |
| `channel: 'chromium'` (new headless, full browser) | the hardware GPU, with no flags | local real-GPU runs |
| `--use-angle=swiftshader --enable-unsafe-swiftshader` | software | forcing software everywhere |
| `--use-angle=<d3d11, metal or gl> --ignore-gpu-blocklist` (plus `--force_high_performance_gpu` on a two-GPU laptop) | hardware | real-GPU runs ([setup](verifying-playwright-setup.md)) |
| `--disable-gpu` | software, WebGL still present | never as a way to remove WebGL |
| `--disable-webgl` | no WebGL | testing the fallback |

- [tested] On one Windows machine (Playwright 1.63, Chromium 153) the default launch was software, `channel: 'chromium'` was hardware with no flags, `--disable-gpu` still produced a software WebGL context, and `--disable-webgl` produced none. Run the probe to see your machine's row; it prints only "software" or "hardware".
- [documented] Playwright ships a headless shell for headless runs and a full Chromium for new headless mode; the shell is used unless `channel: 'chromium'` is set, and `npx playwright install --only-shell` or `--no-shell` installs only one of them ([browsers](https://playwright.dev/docs/browsers)). A job that uses `channel: 'chromium'` must install the full browser.
- [documented] Chromium is removing the automatic software WebGL fallback; headless runs opt in with `--enable-unsafe-swiftshader` ([SwiftShader notes](https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/docs/gpu/swiftshader.md)). It was not needed in the run above, so keep the flag on Linux runners rather than find out after an upgrade.
- [general] Put the renderer class in the test report on every run and assert it when a test depends on it; the check is `not.toMatch(/swiftshader|llvmpipe|software|basic render/i)` on `WEBGL_debug_renderer_info` ([GPU setup](verifying-on-a-gpu.md)).

## Starting processes from a gate script

- [general] `spawn(cmd, args, { shell: true })`, the usual way to make `npx` and other `.cmd` shims start on Windows, joins the arguments with spaces and does not quote them (Node prints `DEP0190`). In one run (Windows 11, Node 24.18) `node -e "setTimeout(()=>{},4000)"` reached the shell with its quotes stripped, `>{}` became a redirect that created a file named `{}`, and the failure looked like a bug in the wrapped command. Any wrapper that forwards arbitrary commands (a GPU lock, a lane runner, a retry wrapper) hits it once an argument holds a space, quote, parenthesis or angle bracket.
- [tested] Start Node entry points directly: `spawn(process.execPath, [script, ...args])` with no shell, and resolve a tool's JavaScript entry point (`node_modules/@playwright/test/cli.js`) instead of its `.cmd` shim. [`examples/web/harness/run-node.mjs`](../../../examples/web/harness/run-node.mjs) is that helper in about ten lines, and its merge-lane test passes `(a) {b} > "c" 'd' & e` through unchanged. If a shim is unavoidable, quote every argument yourself before using the shell.

## When WebGL is missing

- [tested] With `--disable-webgl`, `type: Phaser.AUTO` booted on the Canvas renderer (`game.renderer.type === 1`) with no console line, and `type: Phaser.WEBGL` failed with `Cannot create WebGL context, aborting.` and never reached `create`. A smoke test built on `AUTO` can pass on a runner whose WebGL is broken.
- [documented] Filters do not work on the Canvas renderer, and GPU tilemap layers have no Canvas fallback (`skills/filters-and-postfx/SKILL.md` and `skills/tilemaps/SKILL.md` in the package).
- [general] Create the game with `Phaser.WEBGL` in test builds, or assert `game.renderer.type === 2` in the first spec. If the shipped game must also run on Canvas, run a second job on purpose with `Phaser.CANVAS`.

## Configuration worth setting

- [documented] Playwright recommends one worker on CI for stability and shows sharding across jobs for speed ([CI](https://playwright.dev/docs/ci)); it advises against caching browser binaries because restoring is about as slow as downloading. Pin the Docker image to the installed version, `mcr.microsoft.com/playwright:v<version>-<ubuntu codename>`.
- [general] Each worker is a Chromium with its own WebGL context. Two workers is a memory choice, not a correctness one: wait on state, never time, so the count can change ([harness](../../../examples/web/harness/README.md)).
- [general] Test the built output served by `vite preview` (or your bundler's equivalent) with `--strictPort`, not the dev server: dev serves unbundled modules and a reload socket, and the shipped chunks, asset paths and base URL are what break.
- [general] Software WebGL is slow at boot and exact in colour, not in time. Give the job and each test a timeout, drive time with the manual loop or the fake clock ([deterministic driving](deterministic-test-driving.md)), and never assert frames per second there ([Chrome frame budget](chrome-frame-budget.md)).
- [general] Upload `test-results` and the trace on failure, keep a console allow-list for known lines (context lost and restored, `GPU stall due to ReadPixels`) and fail on everything else, and keep the Firefox and WebKit job advisory until it has stayed green ([smoke workflow](../../../examples/web/harness/ci/smoke.yml)).

## Visual baselines

- [documented] Playwright keeps baselines per browser and platform and advises generating them where they are checked ([test snapshots](https://playwright.dev/docs/test-snapshots)).
- [general] Either generate and check golden images in one pinned container, or keep them out of CI and run them locally with the GPU flags. A baseline made on a laptop and checked on a runner fails on text and filters, not on your code ([pixel assertions](visual-and-pixel-assertions.md)).
