# Profiling a game against a frame budget (method, applied to Phaser)

Use this when a game must hit a frame budget (for example 120 fps) or grow its content by a stated percentage without missing one. It adds diagnosis design and a right-sized shipping bar (section 5); [performance](performance.md) has the measuring tools and findings, and [Chrome frame budget](chrome-frame-budget.md) the Chrome method. The method comes from a native Unreal game investigation. The Unreal half is the `unreal-native` skill (agent-unreal). Labels: **[tested]** is a claim a reader can reproduce from this repo, **[documented]** was read in source or docs, **[general]** is method or guidance, including figures from one project that this repo does not reproduce.

## 1. Fix the budget, then decompose the frame

- [general] Write the target in milliseconds before touching code: 60 Hz is 16.67 ms, 120 Hz is 8.33 ms, 144 Hz is 6.94 ms. Decide which statistic must meet it (mean, p95, p99, max); a mean under budget with a p95 over it still drops frames.
- [general] Split one frame into main-thread JavaScript (sim step, scene updates, render submission), GPU, and everything else the page does (GC, long tasks, compositing). Optimise the largest part first.
- [general] In one native-engine investigation the GPU took about 1 ms and the game thread nearly all the rest, so culling and instancing could not reach the budget.
- [documented] In Phaser 4.2.1 `game.loop.actualFps` is a once-a-second average, `delta` is smoothed when `smoothStep` is on, and `rawDelta` is the unsmoothed value. Time frames yourself from `PRE_STEP` to `POST_RENDER` and from `requestAnimationFrame` timestamps plus callback-start `performance.now()` ([section 2](chrome-frame-budget.md)); do not read a budget from `actualFps`.
- [general] Split the main-thread time further with `performance.mark` and `performance.measure` around the sim step, each system's update and the render call. A gap between them is a long task that is not yours (decode, GC).
- [general] Measure the sim alone (Node, no Phaser, no GPU) and then the rendered game on a real GPU. The difference is the cost that exists only when something is drawn. In that investigation the headless run missed 1.4 to 2.9 ms per frame depending on the scene, because no render state existed to update; budget from the rendered figure and attribute with the headless one.
- [general] Software WebGL invents CPU costs and hides GPU ones; its numbers are not frame times ([verifying on a GPU](verifying-on-a-gpu.md)).

## 2. Attribute cost with an ablation matrix

This is diagnosis, used to find where the milliseconds go; it is not an acceptance gate. One row per switch that turns a system off or scales its content, run through the same scripted scene.

- [general] Rows: each system off alone (effects, scenery animation, weather, entities, audio, hazards, UI), plus scale rows at 1.25x and 1.5x of the content you intend to add. Add a row only for something you could change.
- [general] Scene: a fixed seed and a scripted run through the manual frame loop or a command log ([verifying on a GPU](verifying-on-a-gpu.md)). Cut the same measured window every time and discard warm-up (asset decode, shader compile, first chunk binds).
- [general] Order: interleave (A B C, A B C), never all repeats of one row together, so thermal and background drift hit every row equally. Repeat each row a few times.
- [general] Report mean, p95, max and draw calls per row against a same-session baseline.
- [general] Rendered runs are noisy: in one investigation a scene's rendered baseline ranged 12.3 to 14.4 ms over three repeats against 10.4 to 10.9 headless, and "effects off" read slower than the baseline. Attribute with the quiet run, confirm in the noisy one, and read a delta inside the visible spread as zero.
- [general] A row that fails must be logged, not skipped. In one investigation both scale rows wrote no result for any repeat; reading the log found the gap, the switch was redefined to scale only what it could, and the rows were re-run. A scale row that reads faster than a smaller one is noise or a bug.
- [general] Avoid contamination: DevTools open, a hidden tab (`requestAnimationFrame` is throttled), another benchmark or a build sharing the machine, battery saver. Note the cause beside any run you discard.
- [general] The baseline build must carry the same sampler as the experiments or only one side reports. Keep baseline builds out of any cleanup script (one deleted one).
- [general] Experiment switches (`?exp=noweather,scenery=1.5`) are tooling, not product: keep them on a never-merged branch.

## 3. Turn deltas into a per-item cost

- [general] Cost per item per frame is the row's delta divided by the items it removed; check it with timing scopes inside the system. Record the count it scales with (O(items), O(items x cars) for pairwise tests, per spawn event) and the ceiling beside it.
- [general] Compute a budget table instead of guessing: fixed cost, plus cost per item times the item count at 1.0x, 1.25x and 1.5x, against the target. A pairwise system scales faster than the content scale; mark it.
- [general] [performance](performance.md) holds per-item results reported from one Phaser project and not reproduced here (hundreds of pooled images with typed-array state cost well under a millisecond; a light costs a quad). A row is: system, items, microseconds each, scaling, ms at 1.0x, 1.25x, 1.5x.
- [general] A model built from sim-only timers is a lower bound. In one native investigation it predicted a few tenths of a millisecond for +50% scenery and effects while the rendered run gained about 2 ms, because transform changes also dirtied render state. Validate the table with a rendered scale row.

## 4. Exact or behaviour-changing: who approves

- [general] Exact: the observable result is bit-identical to the old code (a hoisted loop, a cache keyed on every input, a cheap reject of work that could not matter). Behaviour-changing: it can alter a path, a spawn or a pose (lower AI rate, distance-gated animation). The class decides who approves, not how many runs are made: exact changes ship on the bar below; behaviour changes need the owner, so keep them behind a flag and show the measured gain.
- [general] When you claim a refactor is exact, add an in-game shadow check: compute the old and the new result side by side, compare them bitwise, and count both mismatches and comparisons. Zero mismatches over zero comparisons proves nothing.
- [general] Trajectory or output-file equality between two runs is not an exactness proof when runs are not bit-reproducible. In one investigation two runs of the same unchanged build already differed (one value near 19 s); the shadow counters (millions of comparisons, no mismatches) were the proof. A seeded Phaser-free sim with no wall clock can use a state hash; check that it repeats first.
- [general] Do not build process around re-architecting existing game AI. Do the exact local fixes; take a behaviour-changing AI change to the owner as a design decision.

## 5. Right-sized verification

- [general] Ship when the change is a good idea architecturally and you are reasonably sure it does not make the game worse. Verification scales with blast radius, not with the method above.
- [general] The bar: the project's own tests and automation, the shadow check above when exactness is claimed, and before and after frame time on the three worst scenes by frame time, two runs each. One independent verifier per PR, merge when it passes, and a one-paragraph rollback note in the PR.
- [general] Not required: sweeps over every profile, noise-floor studies, verifier panels. In one investigation an exact fix gave no gain on the worst scene; before and after numbers caught that cheaply.

## 6. What changes browser numbers

- [documented] Playwright can record a Chromium trace (`browser.startTracing`, [section 7](chrome-frame-budget.md)) and long tasks and long animation frames start at 50 ms, so they find stalls, not an 8.33 ms miss. GC pauses show in a trace or with `--js-flags=--trace-gc`; neither measured here.
- [general] Tracing and sampling profilers slow the page (5 to 8% in one native-engine investigation). Take headline numbers untraced.
- [general] Draw-call and batch counts come from wrapping the GL draw functions ([performance](performance.md)). Compare counts across rows; a row that changes draws without changing frame time was not the bottleneck.
- [general] Check display-list size, objects drawn outside `camera.worldView`, texture or blend changes that break a batch, and per-frame allocation in `update`.

## Evidence status

- [general] Browser figures come from one project (performance.md). The matrix, cost model and exactness checks were measured in a native Unreal game, not Phaser.
- [general] No Phaser game has yet been through the matrix, a 1.25x and 1.5x cost table, or a GC measurement; record the numbers here when one is.
