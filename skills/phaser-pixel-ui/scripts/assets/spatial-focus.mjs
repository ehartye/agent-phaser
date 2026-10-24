// Pure spatial focus for keyboard and controller menus. No Phaser import, no DOM: items are plain rectangles, so the same
// function runs in a unit test, in a headless layout check and inside a scene.
//
//   import { nextFocus } from './spatial-focus.mjs';
//   const id = nextFocus(items, currentId, 'right', { group: 'modal' });
//
// items: [{ id, rect: { x, y, w, h }, enabled?: boolean, group?: string }]
// direction: 'left' | 'right' | 'up' | 'down'
// options: { wrap = true, group, driftWeight = 2, epsilon = 0.001 }
// Returns the id to focus next. It returns currentId when nothing qualifies, and the first item in reading order
// (top to bottom, then left to right) when currentId is null or no longer a candidate.

const AXES = {
  right: { along: 'x', sign: 1 },
  left: { along: 'x', sign: -1 },
  down: { along: 'y', sign: 1 },
  up: { along: 'y', sign: -1 },
};

export function centre(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Candidates are enabled items, restricted to options.group when it is given (a modal passes its own group). */
export function candidates(items, group) {
  return items.filter((item) => item.enabled !== false && (group === undefined || item.group === group));
}

/** Top to bottom, then left to right, by centre. Rows are separated by half the smaller item height. */
export function readingOrder(items) {
  return [...items].sort((a, b) => {
    const ca = centre(a.rect), cb = centre(b.rect);
    const rowGap = Math.min(a.rect.h, b.rect.h) / 2;
    if (Math.abs(ca.y - cb.y) > rowGap) return ca.y - cb.y;
    return ca.x - cb.x;
  });
}

export function nextFocus(items, currentId, direction, options = {}) {
  const axis = AXES[direction];
  if (!axis) throw new Error(`unknown direction "${direction}"`);
  const { wrap = true, group, driftWeight = 2, epsilon = 0.001 } = options;
  const pool = candidates(items, group);
  const current = pool.find((item) => item.id === currentId);
  if (!current) return pool.length ? readingOrder(pool)[0].id : currentId;

  const from = centre(current.rect);
  const across = axis.along === 'x' ? 'y' : 'x';
  const measured = pool
    .filter((item) => item.id !== currentId)
    .map((item, order) => {
      const to = centre(item.rect);
      return { id: item.id, order, ahead: (to[axis.along] - from[axis.along]) * axis.sign, drift: Math.abs(to[across] - from[across]), position: to[axis.along] * axis.sign };
    });

  const ahead = measured.filter((m) => m.ahead > epsilon);
  const pick = (list, score) => list.reduce((best, m) => {
    const s = score(m);
    return !best || s < best.s || (s === best.s && m.drift < best.m.drift) ? { m, s } : best;
  }, null);

  const found = pick(ahead, (m) => m.ahead + driftWeight * m.drift);
  if (found) return found.m.id;
  if (!wrap) return currentId;

  // Wrap only to items that lie behind the current one on this axis, entering from the far side on the nearest row or column.
  const behind = measured.filter((m) => m.ahead < -epsilon);
  if (!behind.length) return currentId;
  const farthest = Math.min(...behind.map((m) => m.position));
  const wrapped = pick(behind, (m) => driftWeight * m.drift + (m.position - farthest));
  return wrapped ? wrapped.m.id : currentId;
}

/**
 * Ids of enabled candidates that no sequence of direction presses reaches from startId (breadth first, all four directions).
 * Run it over the rectangles a screen reports at every supported size; an unreachable control is a layout bug.
 */
export function unreachable(items, startId, options = {}) {
  const pool = candidates(items, options.group);
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const direction of Object.keys(AXES)) {
      const next = nextFocus(items, id, direction, options);
      if (next !== null && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return pool.filter((item) => !seen.has(item.id)).map((item) => item.id);
}
