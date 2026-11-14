// Hide what is far away, for a world built from loose display objects. Pure ES module: no Phaser import, no dependencies.
//
// Phaser culls nothing by position: every visible Image is submitted every frame wherever it is. This bucket files each
// object under the chunk its position falls in as you create it, and `update(view)` shows the chunks near the view and
// hides the rest. Objects stay where you put them in the display list, so depth sorting between them is unchanged
// (a Container per chunk would stop a walker and a prop in different chunks from sorting against each other).
// A visibility write happens only when a chunk enters or leaves the ring, never per object per frame.
//
//   const chunks = createChunkVisibility({ chunkWidth: 256, chunkHeight: 256, margin: 1 });
//   for (const prop of area.props) chunks.add(scene.add.image(prop.x, prop.y, prop.key));   // as you build
//   chunks.update(camera.worldView);                                                        // after building, then each frame
//   chunks.move(creature.sprite);                                                           // when a thing has moved
//   chunks.clear();                                                                         // when the area is torn down
//
// Positions are world pixels (for an isometric area, the projected position you gave the object, not its grid cell).
// An object is filed by its anchor point, so `margin` (in chunks) must cover the largest sprite: a tall wall whose anchor
// is one chunk below the view still has to be drawn.
//
// Proof: `node --test tests/phaser-worlds-chunk-visibility.test.mjs`; against real Phaser 4.2.1,
// `node examples/web/phaser-probes/phaser-verification-content-cost.mjs <host project>`.

/**
 * options: chunkWidth and chunkHeight in world pixels (chunkHeight defaults to chunkWidth); margin, the number of chunks
 * kept visible beyond the view on every side (default 1); apply(object, visible), how to show or hide one object (default
 * object.setVisible(visible); pass your own to also call setActive for animated sprites).
 */
export function createChunkVisibility({ chunkWidth, chunkHeight = chunkWidth, margin = 1, apply = (object, visible) => object.setVisible(visible) } = {}) {
  if (!(chunkWidth > 0) || !(chunkHeight > 0)) throw new RangeError('chunkWidth and chunkHeight must be positive numbers of world pixels');
  if (!Number.isInteger(margin) || margin < 0) throw new RangeError('margin must be a whole number of chunks, 0 or more');
  if (typeof apply !== 'function') throw new TypeError('apply must be a function (object, visible)');
  const buckets = new Map();        // 'cx,cy' -> Set of objects
  const home = new Map();           // object -> 'cx,cy'
  let range = null;                 // { x0, y0, x1, y1 } in chunk coordinates, inclusive; null before the first update
  const keyOf = (x, y) => `${Math.floor(x / chunkWidth)},${Math.floor(y / chunkHeight)}`;
  const inRange = (key, r = range) => {
    if (!r) return true;            // before the first update everything stays as it was created
    const comma = key.indexOf(','), cx = Number(key.slice(0, comma)), cy = Number(key.slice(comma + 1));
    return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
  };
  const file = (object, key) => {
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = new Set());
    bucket.add(object);
    home.set(object, key);
  };
  const unfile = (object) => {
    const key = home.get(object);
    if (key === undefined) return undefined;
    const bucket = buckets.get(key);
    bucket.delete(object);
    if (bucket.size === 0) buckets.delete(key);
    home.delete(object);
    return key;
  };
  return {
    /** File an object under the chunk at (x, y), default its own x and y, and give it that chunk's current visibility. Returns the object. */
    add(object, x = object.x, y = object.y) {
      if (home.has(object)) return this.move(object, x, y);
      const key = keyOf(x, y);
      file(object, key);
      if (range) apply(object, inRange(key));
      return object;
    },
    /** Tell the bucket an object is now at (x, y). Does nothing unless it crossed into another chunk. Returns the object. */
    move(object, x = object.x, y = object.y) {
      const key = keyOf(x, y), old = home.get(object);
      if (old === undefined) return this.add(object, x, y);
      if (old === key) return object;
      unfile(object);
      file(object, key);
      if (range && inRange(old) !== inRange(key)) apply(object, inRange(key));
      return object;
    },
    /** Forget an object (before destroying it). Its visibility is left as it is. Returns whether it was filed. */
    remove(object) { return unfile(object) !== undefined; },
    /**
     * Show the chunks the view touches plus `margin` chunks on every side and hide the others. `view` is
     * { x, y, width, height } in world pixels: camera.worldView, or a rectangle around the follow target.
     * Returns { changed, shown, hidden } counting the objects written; an unchanged chunk range writes nothing.
     */
    update(view) {
      if (!view || ![view.x, view.y, view.width, view.height].every(Number.isFinite)) throw new TypeError('update needs a view { x, y, width, height }');
      const next = {
        x0: Math.floor(view.x / chunkWidth) - margin, y0: Math.floor(view.y / chunkHeight) - margin,
        x1: Math.floor((view.x + view.width) / chunkWidth) + margin, y1: Math.floor((view.y + view.height) / chunkHeight) + margin,
      };
      if (range && next.x0 === range.x0 && next.y0 === range.y0 && next.x1 === range.x1 && next.y1 === range.y1) return { changed: false, shown: 0, hidden: 0 };
      const previous = range;
      range = next;
      let shown = 0, hidden = 0;
      for (const [key, bucket] of buckets) {
        const now = inRange(key, next);
        if (previous && inRange(key, previous) === now) continue;   // the first update writes every object once
        for (const object of bucket) { apply(object, now); if (now) shown++; else hidden++; }
      }
      return { changed: true, shown, hidden };
    },
    /** { objects, chunks, visibleObjects, visibleChunks } as of the last update. */
    stats() {
      let visibleObjects = 0, visibleChunks = 0;
      for (const [key, bucket] of buckets) if (inRange(key)) { visibleChunks++; visibleObjects += bucket.size; }
      return { objects: home.size, chunks: buckets.size, visibleObjects, visibleChunks };
    },
    /** Forget every object and the last view. Visibility is left as it is: call this when the area's objects are destroyed. */
    clear() { buckets.clear(); home.clear(); range = null; },
  };
}
