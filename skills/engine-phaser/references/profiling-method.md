# Profiling a game against a frame budget (method, applied to Phaser)

Use this when a game must hit a frame budget (for example 120 fps) or grow its content by a stated percentage without missing one. It adds the experiment design that [performance](performance.md) lacks; read that file for the measuring tools and the findings that already generalise. The method comes from a performance investigation in Dead Redline, a native Unreal game. Its engine-specific half is [Unreal profiling](../../engine-asset-import/references/unreal-native-profiling.md), which refers back here for the steps. Labels: **[tested]** was measured in the named project, **[documented]** was read in source or docs, **[general]** is method that has not been measured in a Phaser game.

## 1. Fix the budget, then decompose the frame

- [general] Write the target in milliseconds before touching code: 60 Hz is 16.67 ms, 120 Hz is 8.33 ms, 144 Hz is 6.94 ms. Decide which statistic must meet it (mean, p95, max); a mean under budget with a p95 over it still drops frames.
- [general] Split one frame into main-thread JavaScript (sim step, scene updates, render submission), GPU, and everything else the page does (GC, long tasks, compositing). Optimise the largest part; the others only matter after it moves.
- [tested] In Dead Redline the GPU took about 1 ms of every frame and the game thread about 99% of it, so culling and instancing could not reach the budget and converting art did not move frame time. The first measurement settled the plan.
- [documented] In Phaser 4.2.1 `game.loop.actualFps` is a once-a-second average, `delta` is smoothed when `smoothStep` is on, and `rawDelta` is the unsmoothed value. Time frames yourself from `PRE_STEP` to `POST_RENDER` and from successive `requestAnimationFrame` timestamps ([performance](performance.md) section 1); do not read a budget from `actualFps`.
- [general] Split the main-thread time further with `performance.mark` and `performance.measure` around the sim step, each system's update and the render call. A long task that is not yours (decode, GC) shows as a gap between the two.
- [general] Measure the sim alone (Node, no Phaser, no GPU) and then the rendered game on a real GPU. The difference is the cost that exists only when something is drawn. In Dead Redline the headless run missed 1.4 to 2.9 ms per frame depending on the level, because no render state existed to update; budget from the rendered figure and attribute with the headless one.
- [general] Software WebGL invents CPU costs and hides GPU ones, so a number from it is not a frame time ([verifying on a GPU](verifying-on-a-gpu.md) lists the flags and the renderer-string assertion).

## 2. Design the ablation matrix

One row per switch that turns a system off or scales its content, run through the same scripted scene.

- [general] Rows: each system off alone (effects, scenery animation, weather, entities, audio, hazards, UI), plus scale rows at 1.25x and 1.5x of the content you intend to add. Add a row only for something you could actually change.
- [general] Scene: a fixed seed and a scripted run through the manual frame loop or a command log ([verifying on a GPU](verifying-on-a-gpu.md)). Cut the same measured window every time and discard warm-up (asset decode, shader compile, first chunk binds).
- [general] Order: interleave (A B C, A B C), never all repeats of one row together, so thermal and background drift hit every row equally. Take at least three repeats per row and per scene.
- [general] Report mean, p95, max, draw calls and the number of runs for every row, with the min to max spread. Compare a row with the baseline from the same session.
- [tested] Spread decides what is believable. On one Dead Redline level the rendered baseline ranged 12.3 to 14.4 ms over three repeats while the headless baseline ranged 10.4 to 10.9. Rendered "effects off" read slower than the baseline and a 1.5x row read faster than 1.25x, both noise. Attribute with the low-noise run, confirm in the noisy one, and treat a delta smaller than the spread as zero.
- [tested] A row that fails must be logged, not skipped. Both scale rows wrote no result for any repeat; the gap was found by reading the log, the switch was redefined to scale only what it could, and the rows were re-run. Check that results rise monotonically with the scale.
- [general] Browser contamination to rule out: DevTools open, a hidden tab (`requestAnimationFrame` is throttled), other tabs or a second benchmark sharing the GPU, an interactive user, a build or bundler watcher running, battery saver, thermal throttling. Use a fresh profile per run and write the cause next to any run you discard. Never run builds during a benchmark.
- [tested] The baseline build must carry the same sampler as the experiments or only one side reports. Keep baseline builds out of any cleanup script; a cleanup script deleted one in Dead Redline.
- [general] Experiment switches (`?exp=noweather,scenery=1.5`) read once at boot are tooling, not product: keep them on a branch that is tagged and never merged.

## 3. Turn deltas into a per-item cost

- [general] Cost per item per frame is the row's delta divided by the items it removed; check it with timing scopes inside the system. Record the count it scales with (O(items), O(items x cars) for pairwise tests, per spawn event) and the ceiling beside it.
- [general] Compute a budget table instead of guessing: fixed cost, plus cost per item times the item count at 1.0x, 1.25x and 1.5x, against the target. A pairwise system scales faster than the content scale; mark it.
- [tested] The Fallow Valley figures in [performance](performance.md) are per-item results: 640 pooled images with typed-array state ran in under 0.3 ms, and each light costs a quad. A template row is: system, items, microseconds each, scaling, ms at 1.0x, 1.25x, 1.5x.
- [tested] A model built from sim-only timers is a lower bound. In Dead Redline it predicted a few tenths of a millisecond for +50% scenery and effects while the rendered run gained about 2 ms, because transform changes also dirtied render state. Validate the table with a rendered scale row.

## 4. Climb the exactness ladder

- [general] Exact: the observable result is bit-identical to the old code (a hoisted loop, a cache keyed on every input, a cheap reject of work that could not matter). Behaviour-changing: it can alter a path, a spawn or a pose (a lower AI rate, distance-gated animation). Ship exact changes after proof; build behaviour-changing ones behind a flag, measure them, and wait for the owner.
- [general] Prove exactness two ways. Run the old and new computation side by side and count mismatches over the whole scripted run. Replay the same seed and command log and compare the sim's state hash every N ticks ([verifying on a GPU](verifying-on-a-gpu.md), determinism).
- [tested] First run the unchanged build twice and compare. In Dead Redline two repeats of the same headless race already differed (one armor value near 19 s), so file equality across builds could not prove anything; the side-by-side counters did (millions of checks, no mismatches). A seeded Phaser-free sim with no wall clock should pass that precheck; verify it.
- [tested] Measure each fix alone and together. One exact change gave no measurable gain and was not worth shipping; the largest gave over 3 ms.

## 5. Browser traps that change the numbers

- [documented] Playwright can record a Chromium trace (`browser.startTracing`) and the page can observe `longtask` entries; Fallow Valley's `tools/perf/profile-title.mjs` uses the latter. Garbage-collection pauses show in a Chrome trace or with `--js-flags=--trace-gc`; neither is measured here.
- [general] Tracing and sampling profilers slow the page (5 to 8% in the Unreal investigation). Take the headline number untraced and use the traced run only for attribution.
- [general] Draw-call and batch counts come from wrapping the GL draw functions ([performance](performance.md)). Compare counts across rows; a row that changes draws without changing frame time was not the bottleneck.
- [general] Check display-list size, objects drawn that do not intersect `camera.worldView`, texture or blend changes that break a batch, per-frame allocation in `update`, and the update loop's share before the renderer's.

## Evidence status

- [tested] Browser figures in this file are Fallow Valley's (performance.md). The matrix, cost model and exactness ladder were measured in Dead Redline (Unreal), not in Phaser.
- [general] No Phaser game has yet been put through the full matrix, a cost table at 1.25x and 1.5x, or a GC measurement; do that and record the numbers beside this method.
