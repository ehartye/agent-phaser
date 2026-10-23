// node --test examples/web/profiling/frame-checks.test.mjs  (no browser, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetMs, percentile, minSamplesFor, intervalsFromTimestamps, dropWarmup, summarize, overBudget, budgetVerdict,
  makeSchedule, entryTypeSummary, atLeast, traceSummary, animationFrameSpans, workPerFrame,
} from './frame-checks.mjs';

test('budgetMs derives the millisecond budget from the refresh rate', () => {
  assert.ok(Math.abs(budgetMs(60) - 16.6667) < 1e-3);
  assert.ok(Math.abs(budgetMs(120) - 8.3333) < 1e-3);
  assert.throws(() => budgetMs(0), RangeError);
});

test('percentile is nearest-rank: the 99th of 10,000 values is the 9,900th', () => {
  const values = Array.from({ length: 10000 }, (_, i) => i + 1);
  assert.equal(percentile(values, 99), 9900);
  assert.equal(percentile(values, 100), 10000);
  assert.equal(percentile(values, 50), 5000);
  assert.equal(percentile([5, 1, 3], 0), 1);
  assert.throws(() => percentile([], 50), RangeError);
  assert.throws(() => percentile([1], 101), RangeError);
});

test('a percentile never exceeds the maximum and returns a measured value', () => {
  const v = [16.7, 16.6, 33.3, 16.8, 50];
  assert.ok(v.includes(percentile(v, 95)));
  assert.ok(percentile(v, 95) <= Math.max(...v));
});

test('minSamplesFor says how many samples separate a percentile from the maximum', () => {
  assert.equal(minSamplesFor(99), 100);
  assert.equal(minSamplesFor(95), 20);
  assert.equal(minSamplesFor(100), 1);
});

test('intervals come from successive timestamps and warm-up is discarded', () => {
  assert.deepEqual(intervalsFromTimestamps([0, 16, 33, 50]), [16, 17, 17]);
  assert.deepEqual(dropWarmup([1, 2, 3, 4], 2), [3, 4]);
  assert.deepEqual(dropWarmup([1, 2], 5), []);
});

// A fixture shaped like the tail case the sources describe: a good mean hiding a few long frames.
const steady = Array(97).fill(16.7);
const hitchy = [...steady, 33.3, 33.3, 66.7];

test('summarize reports percentiles and the maximum next to the mean', () => {
  const s = summarize(hitchy);
  assert.equal(s.count, 100);
  assert.ok(s.mean < 18.5);
  assert.equal(s.p50, 16.7);
  assert.equal(s.p95, 16.7);
  assert.equal(s.p99, 33.3);
  assert.equal(s.max, 66.7);
});

test('the mean can pass a 60 Hz budget while p99 and max fail it', () => {
  const budget = budgetMs(60);
  const frames = [...Array(97).fill(12), 40, 40, 40]; // 12 ms frames with three 40 ms hitches
  assert.equal(budgetVerdict(frames, budget, 'mean').pass, true);
  assert.equal(budgetVerdict(frames, budget, 'p95').pass, true);
  assert.equal(budgetVerdict(frames, budget, 'p99').pass, false);
  assert.equal(budgetVerdict(frames, budget, 'max').pass, false);
  assert.deepEqual(overBudget(frames, budget), { over: 3, fraction: 0.03 });
});

test('toleranceMs absorbs timestamp rounding at the budget', () => {
  assert.equal(budgetVerdict(steady, budgetMs(60), 'max').pass, false);
  assert.equal(budgetVerdict(steady, budgetMs(60), 'max', 0.5).pass, true);
});

test('a percentile asked of too few samples is insufficient, not a pass', () => {
  const v = budgetVerdict(Array(50).fill(10), 16.7, 'p99');
  assert.equal(v.pass, null);
  assert.match(v.reason, /at least 100 samples/);
  assert.equal(budgetVerdict(Array(50).fill(10), 16.7, 'p95').pass, true);
});

test('an unknown statistic is refused', () => {
  assert.throws(() => budgetVerdict([1, 2, 3], 5, 'median'), RangeError);
});

test('makeSchedule is deterministic and clips spikes to the run', () => {
  const s = makeSchedule({ frames: 10, baseMs: 6, spikes: [{ at: 2, count: 2, ms: 25 }, { at: 9, count: 3, ms: 60 }] });
  assert.deepEqual(s, [6, 6, 25, 25, 6, 6, 6, 6, 6, 60]);
  assert.deepEqual(s, makeSchedule({ frames: 10, baseMs: 6, spikes: [{ at: 2, count: 2, ms: 25 }, { at: 9, count: 3, ms: 60 }] }));
});

test('workPerFrame adds the phases of each frame', () => {
  assert.deepEqual(workPerFrame([{ sim: 4, render: 2 }, { sim: 14, render: 6 }]), [6, 20]);
});

test('the 50 ms floor drops frames of 25 and 30 ms that interval sampling keeps', () => {
  // Fixture: entry durations as a long-animation-frame observer delivered them for a run with spikes of 25, 30 and 60 ms.
  const loaf = [{ entryType: 'long-animation-frame', duration: 70 }];
  const intervals = [...Array(10).fill(16.7), 33.3, 33.3, 60.4];
  assert.equal(atLeast(loaf, 50).length, 1);
  assert.equal(overBudget(intervals, budgetMs(60), 0.5).over, 3);
  assert.deepEqual(entryTypeSummary([...loaf, { entryType: 'longtask', duration: 60 }]), {
    'long-animation-frame': { count: 1, maxDuration: 70 },
    longtask: { count: 1, maxDuration: 60 },
  });
});

const trace = {
  traceEvents: [
    { name: 'TimeStamp', cat: 'devtools.timeline', ph: 'I', ts: 1 },
    { name: 'TimeStamp', cat: 'devtools.timeline', ph: 'I', ts: 2 },
    { name: 'sim', cat: 'blink.user_timing', ph: 'b', ts: 3 },
    { name: 'sim', cat: 'blink.user_timing', ph: 'e', ts: 9 },
    { name: 'AnimationFrame', cat: 'devtools.timeline', ph: 's', id: 0, ts: 1000 },
    { name: 'AnimationFrame', cat: 'devtools.timeline', ph: 'f', id: 0, ts: 17700 },
    { name: 'AnimationFrame', cat: 'devtools.timeline', ph: 's', id: 1, ts: 17710 },
    { name: 'AnimationFrame', cat: 'devtools.timeline', ph: 'f', id: 1, ts: 42900 },
    { name: 'AnimationFrame', cat: 'devtools.timeline', ph: 's', id: 2, ts: 43000 },
    { name: 'Other', cat: 'a,b', ph: 'X', ts: 5 },
  ],
};

test('traceSummary counts events, categories and the named events a trace should hold', () => {
  const s = traceSummary(trace, ['TimeStamp', 'sim', 'missing']);
  assert.equal(s.eventCount, 10);
  assert.equal(s.categories['devtools.timeline'], 7);
  assert.equal(s.categories.a, 1);
  assert.deepEqual(s.names.TimeStamp, { count: 2, categories: ['devtools.timeline'] });
  assert.deepEqual(s.names.sim, { count: 2, categories: ['blink.user_timing'] });
  assert.deepEqual(s.names.missing, { count: 0, categories: [] });
});

test('animationFrameSpans pairs flow starts with finishes and skips an unfinished frame', () => {
  const spans = animationFrameSpans(trace);
  assert.equal(spans.length, 2);
  assert.ok(Math.abs(spans[0] - 16.7) < 1e-9);
  assert.ok(Math.abs(spans[1] - 25.19) < 1e-9);
  assert.deepEqual(animationFrameSpans(trace.traceEvents), spans);
  assert.deepEqual(animationFrameSpans({}), []);
});
