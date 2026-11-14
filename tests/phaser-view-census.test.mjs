// Proves the view census on plain stand-ins for a Phaser game: what counts as submitted, where each object is sorted
// (in view, near, far, unmeasured), what hiding does, and when the check fails.
// Run: node --test tests/phaser-view-census.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkViewCensus, viewCensus } from '../skills/phaser-verification/scripts/assets/view-census.mjs';

const VIEW = { x: 0, y: 0, width: 400, height: 300 };
const image = (x, y, over = {}) => ({ x, y, visible: true, scrollFactorX: 1, scrollFactorY: 1, willRender: () => true, getBounds: () => ({ x: x - 8, y: y - 8, width: 16, height: 16 }), ...over });
const group = (list, over = {}) => ({ visible: true, list, willRender: () => true, ...over });
const camera = (over = {}) => ({ id: 1, name: 'main', visible: true, worldView: VIEW, ...over });
const game = (children, cameras = [camera()], key = 'World') => ({
  scene: { getScenes: (active) => (active ? [{ sys: { settings: { key } }, children: { list: children }, cameras: { cameras } }] : []) },
});

test('objects are sorted by where their bounds lie: in view, within the margin, or far', () => {
  const report = viewCensus(game([image(200, 150), image(399, 299), image(600, 150), image(-390, -290), image(5000, 5000), image(900, 150)]));
  const row = report.cameras[0];
  assert.deepEqual([row.submitted, row.inView, row.nearView, row.far, row.unmeasured], [6, 2, 2, 2, 0]);
  assert.equal(row.farRatio, 2 / 6);
  assert.deepEqual(row.view, VIEW);
  assert.equal(row.scene, 'World');
  assert.deepEqual([report.submitted, report.far, report.margin], [6, 2, 1]);
});

test('the margin is a fraction of the view on each side, and 0 leaves only in view and far', () => {
  const objects = [image(200, 150), image(600, 150), image(1300, 150)];
  assert.deepEqual(pick(viewCensus(game(objects), { margin: 0 })), [1, 0, 2]);
  assert.deepEqual(pick(viewCensus(game(objects), { margin: 1 })), [1, 1, 1]);
  assert.deepEqual(pick(viewCensus(game(objects), { margin: 3 })), [1, 2, 0]);
  assert.throws(() => viewCensus(game(objects), { margin: -1 }), RangeError);
});
const pick = (report) => [report.cameras[0].inView, report.cameras[0].nearView, report.cameras[0].far];

test('a hidden object is not submitted, and a hidden Container or Layer removes every child at once', () => {
  const far = Array.from({ length: 50 }, (_, i) => image(5000 + i * 20, 5000));
  const flat = viewCensus(game([image(10, 10), ...far]));
  assert.deepEqual([flat.cameras[0].submitted, flat.cameras[0].far], [51, 50]);
  far.slice(0, 20).forEach((o) => { o.visible = false; });
  assert.equal(viewCensus(game([image(10, 10), ...far])).cameras[0].submitted, 31);
  const chunk = group(far.map((o) => ({ ...o, visible: true })), { visible: false });
  assert.deepEqual(pick(viewCensus(game([image(10, 10), chunk]))), [1, 0, 0]);
});

test('leaves inside nested Containers are counted, and the Containers themselves are not', () => {
  const report = viewCensus(game([group([image(10, 10), group([image(20, 20), image(9000, 0)])])]));
  assert.deepEqual([report.cameras[0].submitted, report.cameras[0].inView, report.cameras[0].far], [3, 2, 1]);
});

test('an object the camera ignores is not submitted to that camera, and each camera gets its own row', () => {
  const hud = image(10, 10, { willRender: (cam) => cam.name === 'ui' });
  const world = image(50, 50, { willRender: (cam) => cam.name === 'main' });
  const report = viewCensus(game([hud, world, image(7000, 0)], [camera(), camera({ id: 2, name: 'ui' }), camera({ id: 4, name: 'off', visible: false })]));
  assert.deepEqual(report.cameras.map((c) => [c.camera, c.submitted, c.far]), [['main', 2, 1], ['ui', 2, 1]]);
  assert.equal(report.submitted, 4, 'a second camera repeats the pass');
});

test('objects with no bounds and objects pinned to the screen are unmeasured, never far', () => {
  const emitter = { visible: true, willRender: () => true };
  const pinned = image(9000, 9000, { scrollFactorX: 0, scrollFactorY: 0 });
  const row = viewCensus(game([emitter, pinned, image(10, 10)])).cameras[0];
  assert.deepEqual([row.submitted, row.unmeasured, row.inView, row.far], [3, 2, 1, 0]);
});

test('only active scenes are read, and something that is not a game is refused', () => {
  assert.deepEqual(viewCensus({ scene: { getScenes: () => [] } }).cameras, []);
  assert.throws(() => viewCensus({}), /game\.scene\.getScenes is missing/);
});

test('the in-page function is self-contained: its source alone evaluates', () => {
  const report = new Function(`return (${viewCensus})(arguments[0], { margin: 0 })`)(game([image(10, 10), image(900, 900)]));
  assert.deepEqual(pick(report), [1, 0, 1]);
});

test('the check fails a camera that is handed many objects mostly far from its view, and names the numbers', () => {
  const flat = [...Array.from({ length: 40 }, (_, i) => image(i * 9, 100)), ...Array.from({ length: 260 }, (_, i) => image(4000 + i * 30, 4000))];
  const verdict = checkViewCensus(viewCensus(game(flat)));
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures[0], /scene World camera main: 260 of 300 submitted objects are far from the view \(87%, limit 25%\); 40 are in view/);
  assert.equal(checkViewCensus(viewCensus(game(flat)), { maxFarRatio: 0.9 }).ok, true);
});

test('the check passes a small scene, a culled scene and exactly the limit', () => {
  const few = [image(10, 10), ...Array.from({ length: 50 }, () => image(9000, 9000))];
  assert.equal(checkViewCensus(viewCensus(game(few))).ok, true, 'under minSubmitted nothing is judged');
  assert.equal(checkViewCensus(viewCensus(game(few)), { minSubmitted: 10 }).ok, false);
  const culled = [...Array.from({ length: 300 }, (_, i) => image(i, 100)), ...Array.from({ length: 900 }, () => image(9000, 9000, { visible: false }))];
  const ok = checkViewCensus(viewCensus(game(culled)));
  assert.equal(ok.ok, true);
  assert.equal(ok.message, '300 objects submitted, 0 far from a view');
  const atLimit = [...Array.from({ length: 300 }, (_, i) => image(i, 100)), ...Array.from({ length: 100 }, () => image(9000, 9000))];
  assert.equal(checkViewCensus(viewCensus(game(atLimit))).ok, true, '100 of 400 is exactly 25%');
  assert.throws(() => checkViewCensus({}), TypeError);
  assert.throws(() => checkViewCensus(viewCensus(game([])), { maxFarRatio: 2 }), RangeError);
});
