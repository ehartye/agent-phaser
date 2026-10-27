// The variant picker used with agent-beeps sidecars: weights, no immediate repeat, reproducible sequences, and the edge cases of the beeps player's own picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVariantPicker, pickVariantIndex } from '../skills/phaser-audio/scripts/assets/pick-variant.mjs';

// Mulberry32, the generator agent-beeps seeds its own picker with.
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const sidecar = (weights, extra = {}) => ({ variants: weights.map((weight, i) => ({ file: `cue.${i}.wav`, weight })), ...extra });
const draw = (picker, n) => Array.from({ length: n }, () => picker.next().index);

test('a single variant is always returned, even with noRepeat on', () => {
  const picker = createVariantPicker({ file: 'only.wav', variants: [{ file: 'only.wav', weight: 1 }], noRepeat: true }, seeded(1));
  assert.deepEqual(draw(picker, 5), [0, 0, 0, 0, 0]);
  assert.equal(createVariantPicker({ file: 'solo.wav' }, seeded(1)).next().file, 'solo.wav', 'a sidecar with no variants list plays its own file');
});

test('noRepeat never returns the same variant twice in a row, and it is on when the sidecar does not say', () => {
  for (const entry of [sidecar([1, 1, 1, 1]), sidecar([1, 1, 1, 1], { noRepeat: true }), sidecar([5, 1], {})]) {
    const picks = draw(createVariantPicker(entry, seeded(7)), 5000);
    assert.ok(picks.every((p, i) => i === 0 || p !== picks[i - 1]), JSON.stringify(entry));
  }
  const repeating = draw(createVariantPicker(sidecar([1, 1, 1, 1], { noRepeat: false }), seeded(7)), 5000);
  assert.ok(repeating.some((p, i) => i > 0 && p === repeating[i - 1]), 'noRepeat: false allows repeats');
});

test('weights set the proportions when repeats are allowed', () => {
  const picks = draw(createVariantPicker(sidecar([1, 3], { noRepeat: false }), seeded(11)), 20000);
  const share = picks.filter(p => p === 1).length / picks.length;
  assert.ok(Math.abs(share - 0.75) < 0.02, `weight 3 of 4 gave ${share}`);
});

test('a weight of 0 is never picked, and an all-zero draw falls through to the next index', () => {
  const picks = draw(createVariantPicker(sidecar([1, 0, 1], { noRepeat: false }), seeded(3)), 2000);
  assert.ok(!picks.includes(1));
  assert.equal(pickVariantIndex([0, 0, 0], 0, seeded(1), true), 1, 'total weight 0: the index after the last one');
  assert.equal(pickVariantIndex([1, 0], 0, seeded(1), true), 1, 'only the excluded variant had weight: fall through to the next');
});

test('the sequence is reproducible from a seed and uses the injected rng', () => {
  const a = draw(createVariantPicker(sidecar([1, 2, 1]), seeded(42)), 50);
  const b = draw(createVariantPicker(sidecar([1, 2, 1]), seeded(42)), 50);
  const c = draw(createVariantPicker(sidecar([1, 2, 1]), seeded(43)), 50);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(pickVariantIndex([1, 1, 1], -1, () => 0), 0, 'rng 0 takes the first allowed variant');
  assert.equal(pickVariantIndex([1, 1, 1], -1, () => 0.9999999), 2, 'rng just below 1 takes the last');
  assert.equal(pickVariantIndex([1, 1, 1], -1, () => 1), 2, 'rng exactly 1 is clamped to the last');
  assert.equal(pickVariantIndex([1, 1, 1], 0, () => 0, true), 1, 'the previous variant is skipped');
});

test('it returns the sidecar variant with its file name', () => {
  const picker = createVariantPicker(sidecar([1, 1, 1, 1]), seeded(5));
  const first = picker.next();
  assert.match(first.file, /^cue\.[0-3]\.wav$/);
  assert.equal(first.weight, 1);
  assert.throws(() => pickVariantIndex([], -1), RangeError);
});
