# Measuring a web game against a frame budget in Chrome

Use this to measure and report a web game's frame cost in Chrome. The method (decompose, ablate, price items) is [profiling method](profiling-method.md); the tools are in [performance](performance.md). Labels: **[tested]** was run in this repo with `examples/web/profiling` (Chromium 153 through Playwright 1.63, headless, one Windows machine, 3 runs of 180 frames), **[documented]** was read on the named page, **[general]** is method.

## 1. Derive the budget

- [general] Budget in milliseconds is 1000 / refresh rate: 16.67 ms at 60 Hz, 8.33 ms at 120 Hz. The Chrome tutorial gives only "60 FPS" ([Analyze runtime performance](https://developer.chrome.com/docs/devtools/performance)), so the milliseconds are derived. Intel also gives 16.66 ms for 60 FPS ([Profiling Fundamentals](https://www.intel.com/content/www/us/en/developer/articles/technical/unreal-engine-optimization-profiling-fundamentals.html)).
- [tested] A vsync-paced loop cannot show an 8.33 ms budget through intervals. Headless Chromium kept `requestAnimationFrame` near 17 ms with only 6 ms of work, with and without `--disable-gpu-vsync --disable-frame-rate-limit`, in both headless modes. Judge such a budget on the work per frame (section 3).

## 2. Sample frame intervals, report the tail

- [general] Record two series per frame: the `requestAnimationFrame` timestamp argument and `performance.now()` at callback start. Discard warm-up, keep one fixed window, and report mean, p95, p99 and the maximum; gate on the tail, keep the mean as context.
- [tested] The timestamp argument understated the tail. Three consecutive 25 ms frames read one 33.3 ms interval from the argument and three 25.2 ms from callback start; a 60 ms frame read 50.0 against 60.4 ms. In the two quiet runs the maximum was 50.0 from the argument and 60.4 to 60.6 from callback start.
- [documented] Android's guide shows a game averaging 60 FPS with a P99 of 15 FPS (66.6 ms freezes) and calls P99 the stutter indicator ([Frame rate](https://developer.android.com/games/optimize/framerate)). Intel says a percentile needs good sampling and a large enough data set (Profiling Fundamentals).
- [documented] Klein et al. fit smoothness with a fixed percentile of the frame times and cut the error 19.7% against the mean at 6 ms amplitude ([arXiv 2306.01691](https://ar5iv.labs.arxiv.org/html/2306.01691)). It is a small preprint: it supports reporting a tail, not a particular percentile.
- [general] Use nearest-rank percentiles (the 99th of 10,000 is the 9,900th). A p99 over fewer than 100 samples is the maximum, so report the maximum for a short window and say how many frames it covers.

## 3. Mark phases

- [documented] `performance.measure(name, { start, end, detail: { devtools: { dataType: 'track-entry', track, trackGroup, color, tooltipText } } })` puts a span on a custom track in the trace; `track` and `trackGroup` are required for `track-entry` ([MDN Performance.measure()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure)). The panel shows it with **Show custom tracks** ([Performance features reference](https://developer.chrome.com/docs/devtools/performance/reference)).
- [documented] Since Chrome 134 `console.timeStamp(label, start, end, track)` adds custom-track marks without adding entries to the performance timeline ([What's new in DevTools 134](https://developer.chrome.com/blog/new-in-devtools-134)).
- [tested] Confirmed in Chromium 153: three `console.timeStamp` calls left `performance.getEntries().length` at 2; a `performance.measure` added one, and its `detail.devtools` object came back unchanged. In a trace, each `console.timeStamp` is a `TimeStamp` event (category `devtools.timeline`) whose `args.data` holds `message`, `start` and `track`; each measure is a `blink.user_timing` begin/end pair with `detail` as a JSON string, plus a `UserTiming::Measure` event.
- [tested] Summing the sim and render measures gave the per-frame work: all six scheduled spikes (25, 30 and 60 ms) exceeded 8.33 ms in every run, which interval sampling could not show.

## 4. What Long Animation Frames can and cannot flag

- [documented] A long animation frame is a rendering update delayed beyond 50 ms, the same threshold as long tasks. It shipped in Chrome 123, is observed with `PerformanceObserver` type `long-animation-frame`, and feature-detects through `PerformanceObserver.supportedEntryTypes` ([Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames)). Other engines are not checked here.
- [tested] Frames of 25 and 30 ms produced no `long-animation-frame` and no `longtask` entry; the 60 ms frame produced one of each (frame `duration` 70 to 72 ms, task 60 ms; the uncapped-flag runs read 60 ms for the frame). So it cannot enforce 16.67 or 8.33 ms; it finds stalls.
- [general] Use it to attribute a stall (its `scripts` array names the invoker and source) and to catch the worst frames in the field; use your own samples for the budget.

## 5. The Performance panel explains a frame

- [documented] The Frames section marks idle, in-time, partially presented and dropped frames; the **GPU** section shows GPU activity; the **Timings** track shows `performance.mark` and `performance.measure`, with `detail` and stack in Summary; the FPS meter is a real-time estimate ([Performance features reference](https://developer.chrome.com/docs/devtools/performance/reference)).
- [general] Use it to explain a frame you have already found slow with your own series, not to judge a budget. Record in a clean profile with DevTools closed for headline numbers; the tutorial recommends Incognito to avoid extension noise.

## 6. Throttling and its limits

- [documented] CPU throttling suspends the tab's main thread in short bursts; at 4x it is suspended about 75% of the time. It does not touch the GPU process; the vendor's example had a 270 ms throttled interaction against 620 ms on a real phone because of GPU work. Calibration (Chrome 134) sets low- and mid-tier presets for your machine and narrows the CPU gap only ([More accurate DevTools performance debugging](https://developer.chrome.com/blog/devtools-grounded-real-world)).
- [tested] CDP `Emulation.setCPUThrottlingRate` at 4x raised a fixed-iteration loop from a 44 ms median to 213 ms (4.8x) and left a wall-clock busy-wait unchanged (mean work 7.0 to 7.1 ms), so a busy-wait does not model CPU cost under throttling.
- [general] A throttled laptop trace is a lower bound for a phone's GPU-heavy frame; confirm on a real device.

## 7. Capture a trace from a script

- [tested] `browser.startTracing(page, { path, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8.execute'] })` and `browser.stopTracing()` wrote a JSON file with `traceEvents` and `metadata`: about 1.8 MB and 8,100 events for 210 frames.
- [tested] It held one `AnimationFrame` flow start and finish per frame whatever its length: 210 spans, of which 6 were 25 ms or longer (36.6, 25.2, 25.1, 69.9, 40.7, 30.2 ms in one run), plus `FireAnimationFrame`, `FunctionCall`, `AnimationFrame::Script::Execute` (invoker and source position), `AnimationFrame::Presentation`, the user timings above and V8 garbage-collection events. A trace sees the 25 ms frames the 50 ms floor drops.
- [general] Not tested here: opening the file in the Performance panel, the cost of tracing, and overhead on a heavy game. Take headline numbers untraced.

## 8. Run protocol

- [general] Fix the viewport and device pixel ratio, load the same scene or seed, discard warm-up, and use a window long enough for the statistic (180 frames here; at least 100 for p99).
- [general] Repeat and keep every run. Interleave variants (A B A B) so drift lands on both.
- [tested] On a shared machine one of three identical runs had an unscheduled stall: work max 125 ms, a 139 ms long animation frame and a 125 ms long task, none of which the other two runs showed. Compare runs and say which you discarded and why.
- [general] Record with every number: Chromium version, flags, viewport, throttle rate, window length and run count. Software WebGL is not a frame time ([verifying on a GPU](verifying-on-a-gpu.md)).

## Sources

[Analyze runtime performance](https://developer.chrome.com/docs/devtools/performance), [Performance features reference](https://developer.chrome.com/docs/devtools/performance/reference), [Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames), [More accurate DevTools performance debugging](https://developer.chrome.com/blog/devtools-grounded-real-world), [What's new in DevTools 134](https://developer.chrome.com/blog/new-in-devtools-134), [MDN Performance.measure()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure).
