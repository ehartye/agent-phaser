# Frame-budget probe

A synthetic frame loop with a controllable busy-wait per frame, run in headless Chromium, that shows what each way of
measuring a web game sees. The method it supports is in `skills/phaser-verification/references/chrome-frame-budget.md`.

- `probe.html` runs the loop. Each frame busy-waits for its scheduled time, 70% in a "sim" phase and 30% in a "render" phase,
  marks both with `performance.measure` (with the `detail.devtools` custom-track extension) and `console.timeStamp`, and
  records the `requestAnimationFrame` timestamp, `performance.now()` at callback start, and `PerformanceObserver` entries for
  `long-animation-frame` and `longtask`. It also has a fixed-iteration work function (to see CPU throttling) and a probe of
  whether `console.timeStamp` and `performance.measure` add timeline entries.
- `run.mjs` serves the page, drives it with Playwright, optionally captures a Chromium trace and prints a summary. It writes
  `report.json` (with the raw interval series) and one trace per run to a unique temporary folder, or to `--out=<dir>`.
- `frame-checks.mjs` holds the pure parts: `budgetMs`, nearest-rank `percentile`, `summarize`, `budgetVerdict`,
  `makeSchedule`, `traceSummary`, `animationFrameSpans`. `frame-checks.test.mjs` tests them with fixtures and needs no browser:
  `node --test examples/web/profiling/frame-checks.test.mjs`.

```text
# Playwright comes from `npm i -D playwright` or PLAYWRIGHT_DIR (an installed playwright folder), as for verify.mjs
node web/profiling/run.mjs                       # 3 runs, 60 Hz budget, trace on
node web/profiling/run.mjs --hz=120 --runs=5     # judge against 8.33 ms
node web/profiling/run.mjs --throttle=4          # CDP CPU throttling at 4x
node web/profiling/run.mjs --uncapped            # adds --disable-gpu-vsync --disable-frame-rate-limit
node web/profiling/run.mjs --channel=chromium    # the full browser in new headless mode instead of the headless shell
node web/profiling/run.mjs --no-trace --out=<dir>
```

The schedule is fixed: 30 warm-up frames and then a measured window of 180 frames of 6 ms with three 25 ms frames, one 60 ms frame
and two 30 ms frames. Each run prints three series against the budget: the `requestAnimationFrame` timestamp interval, the
callback-start interval, and the summed sim and render work. It also prints the `long-animation-frame` and `longtask`
entries seen in the window, a fixed-iteration timing, and the trace's frame spans.

The probe measures the main thread and the animation cadence, not rendering, so it needs no GPU. Interval verdicts carry a 0.5 ms
tolerance for timestamp rounding. Headless Chromium paces `requestAnimationFrame` at about 60 Hz whether or not the uncapped
flags are passed (checked in both headless modes), so a 120 Hz budget is judged on the work series here.
Runs on a shared machine vary: keep every run's report and compare them.
