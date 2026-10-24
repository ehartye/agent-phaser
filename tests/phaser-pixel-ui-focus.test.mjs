import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFocus, readingOrder, unreachable } from '../skills/phaser-pixel-ui/scripts/assets/spatial-focus.mjs';

// The helper that the ui-layout-focus-and-navigation reference ships. Pure geometry, no Phaser.
const item = (id, x, y, w = 20, h = 10, extra = {}) => ({ id, rect: { x, y, w, h }, ...extra });
const grid = [
  item('a', 0, 0), item('b', 30, 0), item('c', 60, 0),
  item('d', 0, 20), item('e', 30, 20), item('f', 60, 20),
];

test('moves to the nearest item in the pressed direction', () => {
  assert.equal(nextFocus(grid, 'a', 'right'), 'b');
  assert.equal(nextFocus(grid, 'b', 'right'), 'c');
  assert.equal(nextFocus(grid, 'b', 'down'), 'e');
  assert.equal(nextFocus(grid, 'e', 'up'), 'b');
  assert.equal(nextFocus(grid, 'c', 'left'), 'b');
});

test('drift across the axis costs double, so the same row beats a nearer item on another row', () => {
  const items = [item('here', 0, 0), item('sameRowFar', 50, 0), item('otherRowNear', 25, 14)];
  assert.equal(nextFocus(items, 'here', 'right'), 'sameRowFar');
});

test('wraps within the same row or column and stays put when wrap is off', () => {
  assert.equal(nextFocus(grid, 'c', 'right'), 'a');
  assert.equal(nextFocus(grid, 'd', 'left'), 'f');
  assert.equal(nextFocus(grid, 'a', 'up'), 'd');
  assert.equal(nextFocus(grid, 'c', 'right', { wrap: false }), 'c');
});

test('a vertical list does not move on left or right, and wraps on up and down', () => {
  const list = [item('one', 0, 0, 80), item('two', 0, 14, 80), item('three', 0, 28, 80)];
  assert.equal(nextFocus(list, 'two', 'left'), 'two');
  assert.equal(nextFocus(list, 'two', 'right'), 'two');
  assert.equal(nextFocus(list, 'three', 'down'), 'one');
  assert.equal(nextFocus(list, 'one', 'up'), 'three');
});

test('skips disabled items and honours a group (a modal)', () => {
  const items = [item('a', 0, 0), item('b', 30, 0, 20, 10, { enabled: false }), item('c', 60, 0), item('ok', 0, 40, 20, 10, { group: 'modal' }), item('cancel', 30, 40, 20, 10, { group: 'modal' })];
  assert.equal(nextFocus(items, 'a', 'right'), 'c');
  assert.equal(nextFocus(items, 'ok', 'right', { group: 'modal' }), 'cancel');
  assert.equal(nextFocus(items, 'cancel', 'right', { group: 'modal' }), 'ok', 'wrap stays inside the group');
  assert.equal(nextFocus(items, 'a', 'down', { group: 'modal' }), 'ok', 'a current item outside the group re-enters at the group start');
});

test('enters at the first item in reading order when nothing is focused or the focus was removed', () => {
  assert.equal(nextFocus(grid, null, 'down'), 'a');
  assert.equal(nextFocus(grid.slice(1), 'a', 'down'), 'b');
  assert.deepEqual(readingOrder([item('z', 40, 2), item('y', 0, 0), item('x', 0, 30)]).map((i) => i.id), ['y', 'z', 'x']);
});

test('a lone item and an empty list stay put', () => {
  assert.equal(nextFocus([item('only', 0, 0)], 'only', 'right'), 'only');
  assert.equal(nextFocus([], null, 'right'), null);
});

test('rejects an unknown direction', () => {
  assert.throws(() => nextFocus(grid, 'a', 'diagonal'), /unknown direction/);
});

test('reports controls that no direction sequence reaches', () => {
  assert.deepEqual(unreachable(grid, 'a'), []);
  const stacked = [...grid, item('hidden', 30, 0)];   // same centre as 'b'
  assert.deepEqual(unreachable(stacked, 'a'), ['hidden']);
  const withDisabled = [...grid, item('off', 90, 40, 20, 10, { enabled: false })];
  assert.deepEqual(unreachable(withDisabled, 'a'), [], 'disabled items are not candidates');
});
