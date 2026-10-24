// Proves the pure collision helpers a headless Phaser sim can use instead of engine physics.
// Run: node --test tests/phaser-physics-grid-sweep.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveAndCollide, raycastGrid, sweepAabb } from '../skills/phaser-physics/scripts/assets/grid-sweep.mjs';

const TILE = 16;
// A solid wall column at cell x = 10, rows 0..7, plus a floor row at cell y = 8.
const solidCells = new Set();
for (let y = 0; y <= 8; y++) solidCells.add('10,' + y);
for (let x = -20; x <= 40; x++) solidCells.add(x + ',8');
const grid = { tile: TILE, isSolid: (cx, cy) => solidCells.has(cx + ',' + cy) };

// Seeded generator so a failure reproduces; the test never calls Math.random.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('a box stops flush against a wall face from the left and the right', () => {
  const a = moveAndCollide({ x: 20, y: 20, w: 16, h: 16 }, 500, 0, grid);
  assert.deepEqual([a.x, a.hitX], [10 * TILE - 16, 1]);
  const b = moveAndCollide({ x: 300, y: 20, w: 16, h: 16 }, -500, 0, grid);
  assert.deepEqual([b.x, b.hitX], [11 * TILE, -1]);
});

test('a move of any length cannot tunnel, where testing only the end point does', () => {
  const rand = lcg(7);
  let naiveMisses = 0, sweptMisses = 0;
  const wallLeft = 10 * TILE, wallRight = 11 * TILE;
  for (let i = 0; i < 400; i++) {
    const speed = 900 + rand() * 20000;          // px/s
    const step = speed / 60;                      // px per fixed step
    let x = 20 + rand() * 100;                    // random start phase before the wall: a fixed phase hides tunnelling
    let swept = x, naive = x, naiveThrough = false;
    for (let n = 0; n < 400; n++) {
      swept = moveAndCollide({ x: swept, y: 20, w: 16, h: 16 }, step, 0, grid).x;
      // End-point test: stop only when the new position overlaps the wall, so a long step jumps over it.
      const next = naive + step;
      if (next + 16 > wallLeft && next < wallRight) naive = wallLeft - 16;
      else naive = next;
      if (naive >= wallRight) naiveThrough = true;
    }
    if (swept + 16 > wallLeft + 1e-9) sweptMisses++;
    if (naiveThrough) naiveMisses++;
  }
  assert.equal(sweptMisses, 0);
  assert.equal(naiveMisses, 376, 'the seeded run: the end-point shortcut tunnels in 376 of 400 shots, the sweep in none');
});

test('a diagonal move slides along the wall and lands on the floor', () => {
  const r = moveAndCollide({ x: 100, y: 20, w: 16, h: 16 }, 200, 30, grid);
  assert.equal(r.hitX, 1);
  assert.equal(r.x, 10 * TILE - 16);
  assert.equal(r.y, 50);
  const f = moveAndCollide({ x: 20, y: 100, w: 16, h: 16 }, 0, 300, grid);
  assert.deepEqual([f.y, f.hitY], [8 * TILE - 16, 1]);
  const c = moveAndCollide({ x: 20, y: 140, w: 16, h: 16 }, 0, -500, grid);
  assert.equal(c.hitY, 0, 'nothing above the box in this column');
});

test('a resting box stays grounded every step and a zero move changes nothing', () => {
  let box = { x: 20, y: 8 * TILE - 16, w: 16, h: 16 };
  for (let i = 0; i < 30; i++) {
    const r = moveAndCollide(box, 0, 3, grid);
    assert.deepEqual([r.y, r.hitY], [box.y, 1]);
    box = { ...box, x: r.x, y: r.y };
  }
  assert.deepEqual(moveAndCollide(box, 0, 0, grid), { x: box.x, y: box.y, hitX: 0, hitY: 0 });
});

test('a box that starts inside a solid cell is not ejected', () => {
  const r = moveAndCollide({ x: 10 * TILE + 4, y: 20, w: 8, h: 8 }, 2, 0, grid);
  assert.deepEqual([r.x, r.hitX], [10 * TILE + 6, 0]);
});

test('sweepAabb returns the entry time and face normal, and null for graze or retreat', () => {
  const wall = { x: 100, y: 0, w: 10, h: 100 };
  const hit = sweepAabb({ x: 0, y: 40, w: 10, h: 10 }, 200, 0, wall);
  assert.equal(hit.t, 0.45);                      // face at x = 90 after travelling 90 of 200
  assert.deepEqual([hit.nx, hit.ny], [-1, 0]);
  assert.equal(sweepAabb({ x: 0, y: 40, w: 10, h: 10 }, 80, 0, wall), null, 'ends short');
  assert.equal(sweepAabb({ x: 0, y: 40, w: 10, h: 10 }, -200, 0, wall), null, 'moving away');
  assert.equal(sweepAabb({ x: 0, y: 100, w: 10, h: 10 }, 200, 0, wall), null, 'grazes the bottom edge');
  assert.equal(sweepAabb({ x: 95, y: 40, w: 10, h: 10 }, 5, 0, wall).t, 0, 'already overlapping');
});

test('raycastGrid finds the first solid cell with its entry time and normal', () => {
  const hit = raycastGrid(20, 40, 400, 40, grid);
  assert.deepEqual([hit.cx, hit.cy, hit.nx, hit.ny], [10, 2, -1, 0]);
  assert.ok(Math.abs(hit.t - (10 * TILE - 20) / 380) < 1e-12);
  assert.equal(raycastGrid(20, 40, 150, 40, grid), null, 'segment ends before the wall');
  const down = raycastGrid(40, 20, 40, 400, grid);
  assert.deepEqual([down.cx, down.cy, down.nx, down.ny], [2, 8, 0, -1]);
  assert.equal(raycastGrid(10 * TILE + 3, 20, 400, 20, grid).t, 0, 'starting inside a solid cell');
  assert.equal(raycastGrid(5, 5, 5, 5, grid), null, 'zero-length segment');
});

test('stepping is deterministic and a plain-number snapshot restores it exactly', () => {
  const run = (steps, from) => {
    let s = from ?? { x: 30, y: 20, vx: 220, vy: 0 };
    for (let i = 0; i < steps; i++) {
      const vy = s.vy + 900 / 60;
      const r = moveAndCollide({ x: s.x, y: s.y, w: 14, h: 14 }, s.vx / 60, vy / 60, grid);
      s = { x: r.x, y: r.y, vx: r.hitX ? -s.vx : s.vx, vy: r.hitY ? -vy * 0.6 : vy };
    }
    return s;
  };
  const straight = run(600);
  assert.deepEqual(run(600), straight);
  const half = JSON.parse(JSON.stringify(run(300)));   // the whole state is four numbers, so a save is a JSON round trip
  assert.deepEqual(run(300, half), straight);
});
