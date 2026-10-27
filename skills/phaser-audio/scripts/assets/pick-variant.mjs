// Weighted, no-repeat variant picking for an agent-beeps export sidecar, for a game that plays the exported files through Phaser's
// own sound manager and so does not get the beeps player's variant logic. Pure: no Phaser import and no Web Audio, so it runs in Node.
// The rules mirror the player's picker: weights default to 1, `noRepeat` defaults to true, a single variant is always returned, and the
// previous variant is excluded from the draw when `noRepeat` is on (a total weight of 0 after that falls through to the next index).
// Usage:
//   const picker = createVariantPicker(sidecar, rng);   // sidecar = the parsed <wav>.json: { variants: [{ file, weight? }], noRepeat? }
//   const { file } = picker.next();                     // then this.sound.play(key, config) with the full config on every call
// Pass an rng (a () => number in [0, 1)) to make the sequence reproducible in a test or a replay; the default is Math.random.

/** Index of the next variant. `last` is the previous index, or -1 for none. */
export function pickVariantIndex(weights, last = -1, rng = Math.random, noRepeat = true) {
  const n = weights.length;
  if (n === 0) throw new RangeError('pickVariantIndex needs at least one variant');
  if (n === 1) return 0;
  const allowed = weights.map((w, i) => (noRepeat && i === last ? 0 : Math.max(0, w)));
  const total = allowed.reduce((a, b) => a + b, 0);
  if (total === 0) return (last + 1) % n;
  let r = rng() * total;
  for (let i = 0; i < n; i++) { r -= allowed[i]; if (r < 0) return i; }
  return n - 1;                                   // rng() returned exactly 1: take the last allowed variant
}

/** A picker that remembers the previous pick. `entry` is a sidecar or any { variants, noRepeat? } with { file, weight? } variants. */
export function createVariantPicker(entry, rng = Math.random) {
  const variants = entry.variants?.length ? entry.variants : [{ file: entry.file, weight: 1 }];
  const weights = variants.map(v => v.weight ?? 1);
  const noRepeat = entry.noRepeat ?? true;
  let last = -1;
  return {
    next() {
      last = pickVariantIndex(weights, last, rng, noRepeat);
      return { ...variants[last], index: last };
    },
  };
}
