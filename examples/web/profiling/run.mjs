// Run the synthetic frame-budget probe in headless Chromium and report what each measurement saw.
//   node web/profiling/run.mjs [--hz=60] [--runs=3] [--frames=210] [--warmup=30] [--base=6] [--uncapped]
//                              [--throttle=4] [--no-trace] [--out=<dir>]
// Playwright is resolved from this folder upwards (`npm i -D playwright`), or from PLAYWRIGHT_DIR (an installed playwright folder).
// The probe needs no GPU: it measures the main thread and the requestAnimationFrame cadence, not rendering.
// --uncapped adds --disable-gpu-vsync --disable-frame-rate-limit so intervals can fall below one display refresh.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../serve.mjs';
import {
  budgetMs, intervalsFromTimestamps, dropWarmup, summarize, budgetVerdict, makeSchedule,
  entryTypeSummary, traceSummary, animationFrameSpans, workPerFrame,
} from './frame-checks.mjs';

const opts = { channel: '', hz: 60, runs: 3, frames: 210, warmup: 30, base: 6, uncapped: false, throttle: 1, trace: true, out: '' };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  if (k === 'uncapped') opts.uncapped = true;
  else if (k === 'no-trace') opts.trace = false;
  else if (k in opts && v !== undefined) opts[k] = k === 'out' || k === 'channel' ? v : Number(v);
  else { console.error(`unknown option ${a}`); process.exit(2); }
}

const { chromium } = (() => {
  try { return createRequire(import.meta.url)(process.env.PLAYWRIGHT_DIR ?? 'playwright'); }
  catch { console.error('playwright not found: run `npm i -D playwright` or set PLAYWRIGHT_DIR to an installed playwright folder'); process.exit(2); }
})();

const out = opts.out ? resolve(opts.out) : mkdtempSync(join(tmpdir(), 'frame-probe-'));
mkdirSync(out, { recursive: true });

// Warm-up frames are run at the base cost, then the measured window holds the spikes.
const spikes = [
  { at: opts.warmup + 30, count: 3, ms: 25 },   // three frames over any budget but under the 50 ms floor
  { at: opts.warmup + 90, count: 1, ms: 60 },   // one frame over the 50 ms floor
  { at: opts.warmup + 130, count: 2, ms: 30 },
];
const schedule = makeSchedule({ frames: opts.frames, baseMs: opts.base, spikes });
const budget = budgetMs(opts.hz);
const TOLERANCE_MS = 0.5; // timestamp rounding and vsync jitter

const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}/web/profiling/probe.html`;
const args = opts.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
const browser = await chromium.launch({ headless: true, args, ...(opts.channel ? { channel: opts.channel } : {}) });
const report = { chromium: browser.version(), url: '/web/profiling/probe.html', opts, budgetMs: budget, spikes, runs: [] };

for (let r = 0; r < opts.runs; r++) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(url);
  if (opts.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
  const creation = await page.evaluate(() => window.entryCreationProbe());

  const tracePath = join(out, `trace-run${r}.json`);
  if (opts.trace) await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8.execute'] });
  const result = await page.evaluate((cfg) => window.runProbe(cfg), { schedule });
  if (opts.trace) await browser.stopTracing();
  const fixedWorkMs = await page.evaluate(() => window.cpuWorkMs());

  // Entries from the measured window only: those that started after the last warm-up frame began.
  const windowStart = result.nows[opts.warmup];
  const inWindow = (list) => list.filter((e) => e.startTime >= windowStart);
  const loaf = inWindow(result.loaf), longtask = inWindow(result.longtask);
  const rafWindow = dropWarmup(intervalsFromTimestamps(result.stamps), opts.warmup);
  const callbackWindow = dropWarmup(intervalsFromTimestamps(result.nows), opts.warmup);
  const workWindow = dropWarmup(workPerFrame(result.phases), opts.warmup);
  const verdicts = (series) => ['mean', 'p95', 'p99', 'max'].map((s) => budgetVerdict(series, budget, s, TOLERANCE_MS));
  const entry = {
    run: r,
    fixedWorkMs,
    entryCreation: creation,
    rafTimestampIntervals: summarize(rafWindow),
    callbackStartIntervals: summarize(callbackWindow),
    workPerFrame: summarize(workWindow),
    verdicts: { rafTimestamp: verdicts(rafWindow), callbackStart: verdicts(callbackWindow), work: verdicts(workWindow) },
    framesOverBudget: {
      rafTimestamp: rafWindow.filter((v) => v > budget + TOLERANCE_MS).length,
      callbackStart: callbackWindow.filter((v) => v > budget + TOLERANCE_MS).length,
      work: workWindow.filter((v) => v > budget + TOLERANCE_MS).length,
    },
    loaf: { count: loaf.length, durations: loaf.map((e) => Math.round(e.duration)), supported: result.loafSupported },
    longtask: { count: longtask.length, durations: longtask.map((e) => Math.round(e.duration)), supported: result.longtaskSupported },
    performanceMeasure: { entries: result.measures.length, withDevtoolsDetail: result.measures.filter((m) => m.devtools).length },
    entryTypes: entryTypeSummary([...loaf, ...longtask]),
    raw: { rafIntervals: rafWindow.map((v) => +v.toFixed(1)), callbackStartIntervals: callbackWindow.map((v) => +v.toFixed(1)) },
  };
  if (opts.trace) {
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
    const spans = animationFrameSpans(trace);
    entry.trace = {
      path: tracePath, bytes: statSync(tracePath).size,
      ...traceSummary(trace, ['sim', 'render', 'TimeStamp', 'UserTiming::Measure', 'FireAnimationFrame', 'AnimationFrame', 'AnimationFrame::Presentation', 'RunTask', 'FunctionCall']),
      animationFrameSpans: { count: spans.length, over20ms: spans.filter((v) => v >= 20).length, over50ms: spans.filter((v) => v >= 50).length, max: Math.max(...spans) },
    };
    entry.trace.categories = Object.fromEntries(Object.entries(entry.trace.categories).sort((a, b) => b[1] - a[1]).slice(0, 8));
  }
  report.runs.push(entry);
  await page.close();
}
await browser.close();
server.close();

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const f = (n) => n.toFixed(2);
const line = (label, s) => `  ${label.padEnd(22)} mean ${f(s.mean)}  p95 ${f(s.p95)}  p99 ${f(s.p99)}  max ${f(s.max)}`;
console.log(`Chromium ${report.chromium}  budget ${f(budget)} ms (${opts.hz} Hz)  uncapped=${opts.uncapped}  throttle=${opts.throttle}x  window=${opts.frames - opts.warmup} frames`);
for (const e of report.runs) {
  console.log(`run ${e.run}`);
  console.log(line('rAF timestamp interval', e.rafTimestampIntervals));
  console.log(line('callback-start interval', e.callbackStartIntervals));
  console.log(line('sim + render work', e.workPerFrame));
  console.log(`  frames over budget     rAF ${e.framesOverBudget.rafTimestamp}  callback ${e.framesOverBudget.callbackStart}  work ${e.framesOverBudget.work}`);
  console.log(`  verdict (max)          rAF ${e.verdicts.rafTimestamp[3].pass}  callback ${e.verdicts.callbackStart[3].pass}  work ${e.verdicts.work[3].pass}`);
  console.log(`  long-animation-frame   ${e.loaf.count} ${JSON.stringify(e.loaf.durations)}   longtask ${e.longtask.count} ${JSON.stringify(e.longtask.durations)}   fixed work ${f(e.fixedWorkMs)} ms`);
  if (e.trace) console.log(`  trace ${e.trace.bytes} bytes, ${e.trace.eventCount} events; animation-frame spans ${e.trace.animationFrameSpans.count}, >= 20 ms ${e.trace.animationFrameSpans.over20ms}, >= 50 ms ${e.trace.animationFrameSpans.over50ms}`);
}
console.log(`report and traces: ${out}`);
