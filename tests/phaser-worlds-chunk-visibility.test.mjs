// Proves the chunk-visibility bucket on plain stand-ins for display objects: what is shown and hidden for a view, that an
// unchanged view writes nothing, that moving objects are refiled, and that the ring is the view plus the margin.
// Run: node --test tests/phaser-worlds-chunk-visibility.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChunkVisibility } from '../skills/phaser-worlds/scripts/assets/chunk-visibility.mjs';

let writes = 0;
const thing = (x, y) => ({ x, y, visible: true, setVisible(value) { writes++; this.visible = value; return this; } });
const VIEW = { x: 0, y: 0, width: 200, height: 100 };
// A 20 x 20 field of props, one per 100-pixel chunk, from (-1000, -1000).
const field = () => Array.from({ length: 400 }, (_, i) => thing(-1000 + (i % 20) * 100 + 50, -1000 + Math.floor(i / 20) * 100 + 50));

test('after the first update only the chunks the view touches, plus the margin, are visible', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 1 });
  const props = field();
  props.forEach((p) => chunks.add(p));
  assert.ok(props.every((p) => p.visible), 'adding before the first update changes nothing');
  const result = chunks.update(VIEW);
  // The view covers chunk columns 0..2 and rows 0..1 (its far edges touch the next chunk); one more on every side is 5 x 4.
  assert.deepEqual(result, { changed: true, shown: 20, hidden: 380 });
  assert.equal(props.filter((p) => p.visible).length, 20);
  assert.ok(props.filter((p) => p.visible).every((p) => p.x > -100 && p.x < 400 && p.y > -100 && p.y < 300));
  assert.deepEqual(chunks.stats(), { objects: 400, chunks: 400, visibleObjects: 20, visibleChunks: 20 });
});

test('an update with the same chunk range writes nothing; crossing a chunk edge writes only the chunks that changed', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 1 });
  const props = field();
  props.forEach((p) => chunks.add(p));
  chunks.update(VIEW);
  writes = 0;
  assert.deepEqual(chunks.update({ ...VIEW, x: 40, y: 30 }), { changed: false, shown: 0, hidden: 0 });
  assert.equal(writes, 0, 'scrolling inside a chunk costs no visibility writes');
  const step = chunks.update({ ...VIEW, x: 100 });
  assert.deepEqual(step, { changed: true, shown: 4, hidden: 4 }, 'one column of four enters and one leaves');
  assert.equal(writes, 8);
  assert.equal(props.filter((p) => p.visible).length, 20);
});

test('margin 0 keeps only the chunks the view touches, and a larger margin keeps a wider ring', () => {
  for (const [margin, expected] of [[0, 6], [1, 20], [2, 42]]) {
    const chunks = createChunkVisibility({ chunkWidth: 100, margin });
    const props = field();
    props.forEach((p) => chunks.add(p));
    chunks.update(VIEW);
    assert.equal(props.filter((p) => p.visible).length, expected, `margin ${margin}`);
  }
});

test('an object added after an update takes its chunk\'s visibility at once', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, chunkHeight: 50 });
  chunks.update(VIEW);
  const near = chunks.add(thing(150, 20)), far = chunks.add(thing(5000, 5000));
  assert.equal(near.visible, true);
  assert.equal(far.visible, false);
  const placed = chunks.add(thing(0, 0), 5000, 5000);
  assert.equal(placed.visible, false, 'an explicit position overrides the object\'s own x and y');
});

test('a moving object is refiled when it crosses a chunk edge and is hidden or shown with its new chunk', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 0 });
  const walker = chunks.add(thing(50, 50));
  chunks.update(VIEW);
  writes = 0;
  walker.x = 90; chunks.move(walker);
  assert.equal(writes, 0, 'moving inside a chunk writes nothing');
  walker.x = 150; chunks.move(walker);
  assert.equal(writes, 0, 'moving between two visible chunks writes nothing');
  walker.x = 650; chunks.move(walker);
  assert.equal(walker.visible, false);
  walker.x = 50; chunks.move(walker);
  assert.equal(walker.visible, true);
  assert.deepEqual(chunks.stats(), { objects: 1, chunks: 1, visibleObjects: 1, visibleChunks: 1 });
  const stranger = thing(900, 900);
  chunks.move(stranger);
  assert.equal(stranger.visible, false, 'move files an object it has not seen');
  chunks.add(stranger, 10, 10);
  assert.equal(stranger.visible, true, 'add on a filed object moves it');
  assert.equal(chunks.stats().objects, 2);
});

test('a removed object is no longer written, and clear forgets everything', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 0 });
  const a = chunks.add(thing(50, 50)), b = chunks.add(thing(60, 60));
  chunks.update(VIEW);
  assert.equal(chunks.remove(a), true);
  assert.equal(chunks.remove(a), false);
  chunks.update({ ...VIEW, x: 5000 });
  assert.deepEqual([a.visible, b.visible], [true, false]);
  chunks.clear();
  assert.deepEqual(chunks.stats(), { objects: 0, chunks: 0, visibleObjects: 0, visibleChunks: 0 });
  assert.deepEqual(chunks.update(VIEW), { changed: true, shown: 0, hidden: 0 });
});

test('negative coordinates fall in their own chunks', () => {
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 0 });
  const left = chunks.add(thing(-1, 10)), right = chunks.add(thing(0, 10));
  chunks.update({ x: 0, y: 0, width: 50, height: 50 });
  assert.deepEqual([left.visible, right.visible], [false, true]);
});

test('apply replaces how an object is shown and hidden', () => {
  const calls = [];
  const chunks = createChunkVisibility({ chunkWidth: 100, margin: 0, apply: (object, visible) => { object.visible = visible; object.active = visible; calls.push(visible); } });
  const sprite = { x: 900, y: 900 };
  chunks.add(sprite);
  chunks.update(VIEW);
  assert.deepEqual([sprite.visible, sprite.active, calls], [false, false, [false]]);
});

test('bad options and a bad view are refused', () => {
  assert.throws(() => createChunkVisibility({}), /chunkWidth/);
  assert.throws(() => createChunkVisibility({ chunkWidth: 0 }), RangeError);
  assert.throws(() => createChunkVisibility({ chunkWidth: 10, margin: 0.5 }), /margin/);
  assert.throws(() => createChunkVisibility({ chunkWidth: 10, apply: 1 }), TypeError);
  assert.throws(() => createChunkVisibility({ chunkWidth: 10 }).update({ x: 0 }), /view/);
});
