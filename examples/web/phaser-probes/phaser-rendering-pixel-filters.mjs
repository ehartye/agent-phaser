// Probe for skills/phaser-rendering/references/pixel-art-filters.md (Phaser 4.2.1).
//
// Purpose: measure what the four pixel-art filters do to the pixels of a known source, so a reference can say it from a run and not from
// Phaser's guide: Blocky copies colours (no new ones appear), Pixelate blends (new ones appear), Quantize limits the colour count with and
// without dither, GradientMap maps brightness onto a ramp, filter order matters, and a filter on one object leaves the rest alone.
// Run:  node phaser-rendering-pixel-filters.mjs /absolute/path/to/project-with-phaser-and-playwright   (PROBE_GL=hardware for the GPU backend)
// Expected: JSON evidence, then {"passed":true}. Logic probe on the default WebGL 1 context; see phaser-rendering-harness.mjs.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('pixel-filters', async page => {
  return page.evaluate(async () => {
    const out = {};
    const N = 64;                                              // the source is N x N, drawn 1:1 at the top-left of the 160 x 120 game
    const { scene } = await H.boot({ pixelArt: true }, {
      create() {
        // A source with many distinct colours: a smooth gradient in all three channels, fully opaque.
        const t = this.textures.createCanvas('src', N, N), c = t.getContext();
        const img = c.createImageData(N, N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          img.data[i] = x * 4; img.data[i + 1] = y * 4; img.data[i + 2] = (x + y) * 2; img.data[i + 3] = 255;
        }
        c.putImageData(img, 0, 0); t.refresh();
        this.src = this.add.image(0, 0, 'src').setOrigin(0, 0);
      },
    });
    const cam = scene.cameras.main;

    const read = async () => {
      const px = await H.region(0, 0, N, N);                  // the source area, top-left origin
      const colours = new Set();
      for (let i = 0; i < px.length; i += 4) colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      return { px, colours };
    };
    // Fraction of size x size blocks (aligned to the top-left) whose pixels are all one colour.
    const uniformBlocks = (px, size) => {
      let uniform = 0, total = 0;
      for (let by = 0; by + size <= N; by += size) for (let bx = 0; bx + size <= N; bx += size) {
        total++;
        const first = (by * N + bx) * 4; let same = true;
        for (let y = by; y < by + size && same; y++) for (let x = bx; x < bx + size; x++) {
          const i = (y * N + x) * 4;
          if (px[i] !== px[first] || px[i + 1] !== px[first + 1] || px[i + 2] !== px[first + 2]) { same = false; break; }
        }
        if (same) uniform++;
      }
      return uniform / total;
    };
    const notIn = (a, b) => [...a].filter(c => !b.has(c)).length;

    const base = await read();
    out.sourceColours = base.colours.size;
    out.sourceUniform8 = uniformBlocks(base.px, 8);

    // 1. Blocky: colours are copied, so the output colour set is a subset of the source's and every 8 x 8 block is one colour.
    const blocky = cam.filters.external.addBlocky({ size: 8 });
    const b = await read();
    out.blocky = { colours: b.colours.size, notInSource: notIn(b.colours, base.colours), uniform8: uniformBlocks(b.px, 8), size: { ...blocky.size }, offset: { ...blocky.offset } };
    cam.filters.external.remove(blocky);

    // 2. Pixelate: blends, so colours appear that the source did not contain.
    const pixelate = cam.filters.external.addPixelate(8);
    const p = await read();
    out.pixelate = { colours: p.colours.size, notInSource: notIn(p.colours, base.colours), uniform8: uniformBlocks(p.px, 8), amount: pixelate.amount };
    cam.filters.external.remove(pixelate);
    // Phaser's filters document says the pixel size is 2 + amount: find which block size the output is uniform over.
    out.pixelateBlockSize = {};
    for (const amount of [2, 4, 8]) {
      const f = cam.filters.external.addPixelate(amount), r = await read();
      out.pixelateBlockSize[amount] = Object.fromEntries([amount, amount + 1, amount + 2, amount + 3].map(s => [s, uniformBlocks(r.px, s)]));
      cam.filters.external.remove(f);
    }

    // 3. Quantize with 4 steps per colour channel and an opaque alpha: at most 4^3 = 64 colours, with and without dither.
    const quant = {};
    for (const dither of [false, true]) {
      const q = cam.filters.external.addQuantize({ steps: [4, 4, 4, 1], dither });
      const r = await read();
      quant[dither ? 'dither' : 'plain'] = { colours: r.colours.size, steps: [...q.steps], mode: q.mode };
      cam.filters.external.remove(q);
    }
    out.quantize = quant;

    // 4. GradientMap: a black-to-red ramp turns brightness into red. Source pixels of known brightness: gray 0, 128 and 255.
    const grays = scene.textures.createCanvas('grays', 3, 1), gc = grays.getContext();
    [0, 128, 255].forEach((v, i) => { gc.fillStyle = `rgb(${v},${v},${v})`; gc.fillRect(i, 0, 1, 1); });
    grays.refresh();
    scene.src.setVisible(false);
    const strip = scene.add.image(0, 0, 'grays').setOrigin(0, 0).setScale(8);
    const ramp = cam.filters.external.addGradientMap({ ramp: { colorStart: 0x000000, colorEnd: 0xff0000 } });
    out.gradientMap = { dark: await H.pixel(4, 4), mid: await H.pixel(12, 4), light: await H.pixel(20, 4), dither: ramp.dither, colorFactor: [...ramp.colorFactor] };
    cam.filters.external.remove(ramp);
    strip.destroy(); scene.src.setVisible(true);

    // 5. Order: Blocky then Blur leaves soft edges (new colours); Blur then Blocky ends on blocks (a subset of what the blur produced).
    const blockyFirst = [cam.filters.external.addBlocky({ size: 8 }), cam.filters.external.addBlur(0, 2, 2, 1, 0xffffff, 4)];
    const o1 = await read();
    blockyFirst.forEach(f => cam.filters.external.remove(f));
    const blurFirst = [cam.filters.external.addBlur(0, 2, 2, 1, 0xffffff, 4), cam.filters.external.addBlocky({ size: 8 })];
    const o2 = await read();
    blurFirst.forEach(f => cam.filters.external.remove(f));
    out.order = { blockyThenBlur: { uniform8: uniformBlocks(o1.px, 8), notInSource: notIn(o1.colours, base.colours) }, blurThenBlocky: { uniform8: uniformBlocks(o2.px, 8) } };

    // 5b. Order does not change the cost of the passes: each filter is one full-size pass whatever came before it, so Pixelate or Blocky
    // ahead of a Blur does not shrink the Blur's work. Count the pooled framebuffers a frame asks for, and their sizes, in both orders.
    const passes = async list => {
      const added = list.map(add => add(cam.filters.external)), pool = game.renderer.drawingContextPool, get = pool.get, sizes = [];
      pool.get = function (w, h) { sizes.push(w + 'x' + h); return get.apply(this, arguments); };
      await H.frames(2); sizes.length = 0; await H.frames(1);
      const draws = await H.draws();
      pool.get = get; added.forEach(f => cam.filters.external.remove(f));
      const bySize = {}; sizes.forEach(s => { bySize[s] = (bySize[s] || 0) + 1; });
      return { framebuffers: bySize, draws: draws.elements + draws.instanced };
    };
    const addBlur = fl => fl.addBlur(0, 2, 2, 1, 0xffffff, 4), addBlocky = fl => fl.addBlocky({ size: 8 }), addPixelate = fl => fl.addPixelate(8);
    out.passes = { none: await passes([]), blockyBlur: await passes([addBlocky, addBlur]), blurBlocky: await passes([addBlur, addBlocky]), pixelateBlur: await passes([addPixelate, addBlur]), blurPixelate: await passes([addBlur, addPixelate]), blurOnly: await passes([addBlur]) };

    // 6. A filter on one object leaves everything outside it alone: the left half of the source is blocked, the right half is not.
    scene.src.destroy();
    scene.left = scene.add.image(0, 0, 'src').setOrigin(0, 0).setCrop(0, 0, N / 2, N);
    const own = scene.left.enableFilters().filters.internal.addBlocky({ size: 8 });
    const o = await read();
    const rightHalfSame = (() => { for (let y = 0; y < N; y++) for (let x = N / 2; x < N; x++) { const i = (y * N + x) * 4; if (o.px[i + 3] !== 0 && (o.px[i] || o.px[i + 1] || o.px[i + 2])) return false; } return true; })();
    out.objectFilter = { colours: o.colours.size, rightHalfEmpty: rightHalfSame, blocksInLeftHalf: (() => { let u = 0, t = 0; for (let by = 0; by < N; by += 8) for (let bx = 0; bx < N / 2; bx += 8) { t++; const f = (by * N + bx) * 4; let same = true; for (let y = by; y < by + 8 && same; y++) for (let x = bx; x < bx + 8; x++) { const i = (y * N + x) * 4; if (o.px[i] !== o.px[f] || o.px[i + 1] !== o.px[f + 1] || o.px[i + 2] !== o.px[f + 2]) { same = false; break; } } if (same) u++; } return u / t; })() };
    scene.left.filters.internal.remove(own);
    return out;
  });
});

// The source is not blocky and has thousands of colours.
assert.ok(evidence.sourceColours > 1000, `source colours ${evidence.sourceColours}`);
assert.ok(evidence.sourceUniform8 < 0.05, 'the unfiltered source has no uniform blocks');
// Blocky copies colours.
assert.equal(evidence.blocky.notInSource, 0, 'Blocky introduces no colour the source lacks');
assert.equal(evidence.blocky.uniform8, 1, 'every 8 x 8 block is one colour');
assert.deepEqual(evidence.blocky.size, { x: 8, y: 8 });
assert.ok(evidence.blocky.colours <= 64, 'at most one colour per block');
// Pixelate blends.
assert.ok(evidence.pixelate.notInSource > 0, 'Pixelate produces colours the source does not contain');
assert.equal(evidence.pixelate.amount, 8);
for (const [amount, sizes] of Object.entries(evidence.pixelateBlockSize)) {
  const largest = Math.max(...Object.entries(sizes).filter(([, uniform]) => uniform === 1).map(([size]) => Number(size)));   // blocks of 2 are also uniform inside blocks of 4
  assert.equal(largest, Number(amount) + 2, `Pixelate(${amount}) is uniform over blocks of ${largest}, not amount + 2 (${JSON.stringify(sizes)})`);
}
// Quantize limits the palette.
assert.ok(evidence.quantize.plain.colours <= 64, `plain quantize colours ${evidence.quantize.plain.colours}`);
assert.ok(evidence.quantize.plain.colours < evidence.sourceColours);
assert.ok(evidence.quantize.dither.colours < evidence.sourceColours, 'dither still reduces the colour count');
assert.deepEqual(evidence.quantize.plain.steps, [4, 4, 4, 1]);
// GradientMap maps brightness to the ramp's red.
const near = (got, want, tol = 6) => Math.abs(got - want) <= tol;
assert.ok(near(evidence.gradientMap.dark[0], 0) && evidence.gradientMap.dark[1] === 0 && evidence.gradientMap.dark[2] === 0, `dark ${evidence.gradientMap.dark}`);
assert.ok(near(evidence.gradientMap.mid[0], 128, 12) && evidence.gradientMap.mid[1] === 0, `mid ${evidence.gradientMap.mid}`);
assert.ok(near(evidence.gradientMap.light[0], 255) && evidence.gradientMap.light[1] === 0, `light ${evidence.gradientMap.light}`);
// Order matters.
assert.ok(evidence.order.blockyThenBlur.uniform8 < 1, 'Blocky then Blur leaves soft edges');
assert.equal(evidence.order.blurThenBlocky.uniform8, 1, 'Blur then Blocky ends on blocks');
// Order does not shrink the work: the same pooled framebuffers and the same number of draws in either order.
assert.deepEqual(evidence.passes.blockyBlur.framebuffers, evidence.passes.blurBlocky.framebuffers, 'Blocky and Blur ask for the same framebuffer sizes in either order');
assert.deepEqual(evidence.passes.pixelateBlur.framebuffers, evidence.passes.blurPixelate.framebuffers, 'Pixelate and Blur ask for the same framebuffer sizes in either order');
assert.equal(evidence.passes.blockyBlur.draws, evidence.passes.blurBlocky.draws, 'the same draw count in either order');
assert.ok(evidence.passes.blurOnly.draws > evidence.passes.none.draws && evidence.passes.blockyBlur.draws > evidence.passes.blurOnly.draws, 'each added filter adds draws');
assert.deepEqual(Object.keys(evidence.passes.blockyBlur.framebuffers), ['160x120'], 'every pass is full size: no filter shrinks the framebuffer');
assert.ok(Object.values(evidence.passes.blockyBlur.framebuffers)[0] > Object.values(evidence.passes.blurOnly.framebuffers)[0], 'the check sees an added filter');
// An object filter stays on the object.
assert.equal(evidence.objectFilter.blocksInLeftHalf, 1, 'the filtered object is blocky');
assert.equal(evidence.objectFilter.rightHalfEmpty, true, 'nothing is drawn outside the cropped, filtered object');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ passed: true }));
