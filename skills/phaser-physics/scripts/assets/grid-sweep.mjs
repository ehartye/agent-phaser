// Swept collision against a tile grid, for a headless sim. Pure ES module: no Phaser, no DOM, no dependencies,
// no clock and no randomness, so a Node test can run it and a save can store its state as plain numbers.
//
// Units are world units (pixels). A box is { x, y, w, h } with (x, y) its top-left corner. A box occupies the half-open
// range [x, x + w) x [y, y + h), so a box resting flush against a tile face does not overlap that tile.
// A grid is { tile, isSolid(cx, cy) } where (cx, cy) are integer cell coordinates and tile is the cell size.
// A box that starts inside a solid cell is not pushed out: only cells it has not yet entered can stop it.
//
// Proof: `node --test tests/phaser-physics-grid-sweep.test.mjs`.

/**
 * Move a box by (dx, dy) through the grid, X first and then Y, stopping flush against the first solid cell on each axis.
 * The cost is proportional to the distance moved in cells, not to the speed, and a move of any length cannot tunnel.
 * Returns the new top-left corner and the face hit on each axis: hitX is -1 (left), 0 or 1 (right); hitY is -1
 * (ceiling), 0 or 1 (floor, so `hitY === 1` means grounded).
 */
export function moveAndCollide(box, dx, dy, grid) {
  const x = sweepAxis(box.x, box.w, box.y, box.h, dx, (axisCell, crossCell) => grid.isSolid(axisCell, crossCell), grid.tile);
  // The Y sweep uses the already-moved x, so a diagonal move slides along a wall instead of stopping dead.
  const y = sweepAxis(box.y, box.h, x.pos, box.w, dy, (axisCell, crossCell) => grid.isSolid(crossCell, axisCell), grid.tile);
  return { x: x.pos, y: y.pos, hitX: x.hit, hitY: y.hit };
}

// Sweep one axis. `pos`/`size` are the box's start and length on the moving axis; `crossPos`/`crossSize` are on the
// other axis. `solid(axisCell, crossCell)` is the grid lookup with the arguments already ordered for this axis.
function sweepAxis(pos, size, crossPos, crossSize, delta, solid, tile) {
  if (delta === 0) return { pos, hit: 0 };
  const lo = Math.floor(crossPos / tile);
  const hi = Math.ceil((crossPos + crossSize) / tile) - 1;
  const blocked = (cell) => {
    for (let c = lo; c <= hi; c++) if (solid(cell, c)) return true;
    return false;
  };
  if (delta > 0) {
    const edge = pos + size;
    // Cells whose near face is at or beyond the leading edge, and before the edge's new position.
    for (let cell = Math.ceil(edge / tile); cell * tile < edge + delta; cell++) {
      if (blocked(cell)) return { pos: cell * tile - size, hit: 1 };
    }
    return { pos: pos + delta, hit: 0 };
  }
  // Moving toward smaller coordinates: cells whose far face is at or before the leading edge.
  for (let cell = Math.floor(pos / tile) - 1; (cell + 1) * tile > pos + delta; cell--) {
    if (blocked(cell)) return { pos: (cell + 1) * tile, hit: -1 };
  }
  return { pos: pos + delta, hit: 0 };
}

/**
 * Moving box against one static box. Returns { t, nx, ny } where t in [0, 1] is the fraction of the move at which the
 * boxes first touch and (nx, ny) is the unit normal of the face hit, or null for a miss, a graze, or movement away.
 * t is 0 and the normal (0, 0) when the boxes already overlap. Use it for bullets and pickups instead of testing only
 * the end point.
 */
export function sweepAabb(box, dx, dy, other) {
  // Grow `other` by the moving box and cast the box's top-left corner through it (the slab method).
  const min = [other.x - box.w, other.y - box.h];
  const max = [other.x + other.w, other.y + other.h];
  const p = [box.x, box.y], d = [dx, dy];
  if (p[0] > min[0] && p[0] < max[0] && p[1] > min[1] && p[1] < max[1]) return { t: 0, nx: 0, ny: 0 };
  let tEnter = -Infinity, tExit = Infinity, nx = 0, ny = 0;
  for (let axis = 0; axis < 2; axis++) {
    if (d[axis] === 0) {
      if (p[axis] <= min[axis] || p[axis] >= max[axis]) return null;
      continue;
    }
    let t0 = (min[axis] - p[axis]) / d[axis], t1 = (max[axis] - p[axis]) / d[axis], n = -1;
    if (t0 > t1) { [t0, t1] = [t1, t0]; n = 1; }
    if (t0 > tEnter) { tEnter = t0; nx = axis === 0 ? n : 0; ny = axis === 1 ? n : 0; }
    if (t1 < tExit) tExit = t1;
    if (tEnter >= tExit) return null;
  }
  if (tEnter < 0 || tEnter > 1) return null;
  return { t: tEnter, nx, ny };
}

/**
 * Cast a segment from (x0, y0) to (x1, y1) through the grid (Amanatides and Woo). Returns the first solid cell as
 * { cx, cy, t, nx, ny } with t in [0, 1] along the segment, or null if the segment ends first.
 * t is 0 and the normal is (0, 0) when the segment starts inside a solid cell.
 */
export function raycastGrid(x0, y0, x1, y1, grid) {
  const { tile } = grid;
  let cx = Math.floor(x0 / tile), cy = Math.floor(y0 / tile);
  if (grid.isSolid(cx, cy)) return { cx, cy, t: 0, nx: 0, ny: 0 };
  const dx = x1 - x0, dy = y1 - y0;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const tDeltaX = dx === 0 ? Infinity : Math.abs(tile / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(tile / dy);
  let tMaxX = dx === 0 ? Infinity : ((stepX > 0 ? (cx + 1) * tile : cx * tile) - x0) / dx;
  let tMaxY = dy === 0 ? Infinity : ((stepY > 0 ? (cy + 1) * tile : cy * tile) - y0) / dy;
  for (;;) {
    let t, nx = 0, ny = 0;
    if (tMaxX < tMaxY) { t = tMaxX; cx += stepX; tMaxX += tDeltaX; nx = -stepX; }
    else { t = tMaxY; cy += stepY; tMaxY += tDeltaY; ny = -stepY; }
    if (t > 1) return null;
    if (grid.isSolid(cx, cy)) return { cx, cy, t, nx, ny };
  }
}
