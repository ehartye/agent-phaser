// Pure parts of the frame-budget probe: budget arithmetic, percentiles, the budget verdict, the synthetic frame
// schedule and trace/entry summaries. No browser and no dependencies, so `node --test examples/web/profiling/frame-checks.test.mjs`
// covers them.

/** Frame budget in milliseconds for a refresh rate: 60 Hz is 16.67 ms, 120 Hz is 8.33 ms. */
export const budgetMs = (hz) => {
  if (!(hz > 0)) throw new RangeError('hz must be positive');
  return 1000 / hz;
};

/**
 * Nearest-rank percentile: sort ascending and take the value at rank ceil(p/100 * n), so the 99th percentile of
 * 10,000 values is the 9,900th. Always returns a value that was measured (no interpolation).
 * @param {number[]} values
 * @param {number} p 0 to 100
 */
export function percentile(values, p) {
  if (!values.length) throw new RangeError('no values');
  if (!(p >= 0 && p <= 100)) throw new RangeError('p must be 0 to 100');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Fewest samples for which percentile p can differ from the maximum: 100 for p99, 20 for p95. */
export const minSamplesFor = (p) => (p >= 100 ? 1 : Math.ceil(100 / (100 - p)));

/** Differences between successive requestAnimationFrame timestamps. */
export const intervalsFromTimestamps = (stamps) => stamps.slice(1).map((t, i) => t - stamps[i]);

/** Discard the first n samples (asset decode, shader compile, first-frame costs). */
export const dropWarmup = (values, n) => values.slice(Math.max(0, n));

/** @param {number[]} intervals frame intervals in ms */
export function summarize(intervals) {
  if (!intervals.length) throw new RangeError('no intervals');
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return {
    count: intervals.length,
    mean,
    p50: percentile(intervals, 50),
    p95: percentile(intervals, 95),
    p99: percentile(intervals, 99),
    max: Math.max(...intervals),
  };
}

/** How many intervals exceed the budget, and what fraction of the window. */
export function overBudget(intervals, budget, toleranceMs = 0) {
  const over = intervals.filter((v) => v > budget + toleranceMs).length;
  return { over, fraction: intervals.length ? over / intervals.length : 0 };
}

/**
 * Verdict on a window: the chosen statistic ('mean', 'p95', 'p99', 'max') must be at or under the budget.
 * toleranceMs absorbs timestamp rounding (a 60 Hz loop reads 16.7, not 16.67). A percentile asked of too few samples is reported 'insufficient' because it would just be the maximum.
 * @returns {{ pass: boolean|null, statistic: string, value: number, budget: number, count: number, reason?: string }}
 */
export function budgetVerdict(intervals, budget, statistic = 'p99', toleranceMs = 0) {
  const s = summarize(intervals);
  if (!['mean', 'p50', 'p95', 'p99', 'max'].includes(statistic)) throw new RangeError(`unknown statistic ${statistic}`);
  const base = { statistic, value: s[statistic], budget, toleranceMs, count: s.count, ...overBudget(intervals, budget, toleranceMs) };
  const m = /^p(\d+)$/.exec(statistic);
  if (m && s.count < minSamplesFor(Number(m[1]))) {
    return { ...base, pass: null, reason: `need at least ${minSamplesFor(Number(m[1]))} samples for ${statistic}` };
  }
  return { ...base, pass: s[statistic] <= budget + toleranceMs };
}

/**
 * Synthetic busy-wait per frame: `frames` frames of `baseMs`, with bursts overwritten from `spikes`
 * ({ at, count, ms }). Deterministic, so a probe run can be repeated and compared.
 */
export function makeSchedule({ frames, baseMs, spikes = [] }) {
  const schedule = new Array(frames).fill(baseMs);
  for (const { at, count, ms } of spikes) {
    for (let i = at; i < Math.min(frames, at + count); i++) schedule[i] = ms;
  }
  return schedule;
}

/** Count entries by entryType and keep the longest duration of each, for PerformanceObserver output. */
export function entryTypeSummary(entries) {
  const out = {};
  for (const e of entries) {
    const o = (out[e.entryType] ??= { count: 0, maxDuration: 0 });
    o.count++;
    o.maxDuration = Math.max(o.maxDuration, e.duration ?? 0);
  }
  return out;
}

/** Entries whose duration is at or above a floor, such as the 50 ms long-task and long-animation-frame threshold. */
export const atLeast = (entries, ms) => entries.filter((e) => e.duration >= ms);

/**
 * Summarise a Chrome trace file ({ traceEvents: [...] }): event count, events per category, and for each wanted
 * event name its count and the categories it appeared under.
 * @param {{ traceEvents?: Array<{ name?: string, cat?: string, ph?: string }> } | Array<object>} trace
 * @param {string[]} wanted event names to look for
 */
export function traceSummary(trace, wanted = []) {
  const events = Array.isArray(trace) ? trace : trace.traceEvents ?? [];
  const categories = {};
  const names = Object.fromEntries(wanted.map((n) => [n, { count: 0, categories: new Set() }]));
  for (const e of events) {
    for (const c of String(e.cat ?? '').split(',')) if (c) categories[c] = (categories[c] ?? 0) + 1;
    const hit = names[e.name];
    if (hit) { hit.count++; hit.categories.add(e.cat ?? ''); }
  }
  return {
    eventCount: events.length,
    categories,
    names: Object.fromEntries(Object.entries(names).map(([n, v]) => [n, { count: v.count, categories: [...v.categories].sort() }])),
  };
}

/**
 * Per-frame spans from a Chrome trace: the `AnimationFrame` flow events (ph 's' then 'f' with the same id) are one pair per
 * animation frame, whatever its length, so the trace holds frames the 50 ms long-animation-frame floor never reports.
 * @returns {number[]} spans in milliseconds, in trace order
 */
export function animationFrameSpans(trace) {
  const events = Array.isArray(trace) ? trace : trace.traceEvents ?? [];
  const started = new Map();
  const spans = [];
  for (const e of events) {
    if (e.name !== 'AnimationFrame') continue;
    if (e.ph === 's') started.set(e.id, e.ts);
    else if (e.ph === 'f' && started.has(e.id)) spans.push((e.ts - started.get(e.id)) / 1000);
  }
  return spans;
}

/** Sum of the per-frame phase costs (for example sim + render), the CPU work the page measured with performance.measure. */
export const workPerFrame = (phases) => phases.map((p) => Object.values(p).reduce((a, b) => a + b, 0));
