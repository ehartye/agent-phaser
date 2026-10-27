// The paired normal atlas from agent-sprites (tests/fixtures/normal-atlas, a real surface-lighting export): the colour and normal atlases
// describe the same frames, both images match the atlas size, and the normal image is the "green up" encoding the worlds reference
// relies on. Phaser reads the colour atlas's frame rectangles for both images (the probe phaser-worlds-normal-atlas.mjs proves that
// and the lit result in a browser), so a pair whose rectangles disagree would shade the wrong texels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const dir = new URL('./fixtures/normal-atlas/', import.meta.url);
const json = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const color = json('color.atlas.json'), normal = json('normal.atlas.json');

// A decoder for the 8-bit RGBA, non-interlaced PNGs the exporter writes (all that this test needs).
function decodePng(name) {
  const b = readFileSync(new URL(name, dir));
  assert.deepEqual([...b.subarray(1, 4)], [0x50, 0x4e, 0x47], `${name} is a PNG`);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  assert.deepEqual([b[24], b[25], b[28]], [8, 6, 0], `${name} is 8-bit RGBA, not interlaced`);
  const idat = [];
  for (let o = 8; o < b.length; o += 12 + b.readUInt32BE(o)) if (b.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + b.readUInt32BE(o)));
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0, up = y ? out[(y - 1) * stride + i] : 0, c = i >= 4 && y ? out[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const predictor = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][filter];
      assert.ok(filter <= 4, `PNG filter ${filter}`);
      out[y * stride + i] = (line[i] + predictor) & 255;
    }
  }
  return { w, h, at: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] };
}

test('the fixture pair stays small enough to commit', () => {
  const bytes = ['color.png', 'normal.png', 'color.atlas.json', 'normal.atlas.json'].reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
  assert.ok(bytes <= 20 * 1024, `${bytes} bytes`);
});

test('every colour frame has a normal frame with the same rectangle, trim, size and duration, in the same order', () => {
  assert.equal(normal.frames.length, color.frames.length);
  assert.ok(color.frames.length > 0);
  color.frames.forEach((f, i) => {
    const n = normal.frames[i];
    assert.equal(n.filename, f.filename, `frame ${i} keeps its name`);
    for (const key of ['frame', 'rotated', 'trimmed', 'spriteSourceSize', 'sourceSize', 'duration']) assert.deepEqual(n[key], f[key], `${f.filename}.${key}`);
  });
});

test('tags and pivot are copied to the normal atlas, and both images are as large as the atlas says', () => {
  assert.deepEqual(normal.meta.frameTags, color.meta.frameTags);
  assert.deepEqual(normal.meta.slices, color.meta.slices);
  assert.deepEqual(normal.meta.size, color.meta.size);
  assert.deepEqual(color.meta.frameTags.map(t => t.name), ['sweep']);
  assert.equal(color.meta.slices[0].name, 'pivot');
  for (const [name, atlas] of [['color.png', color], ['normal.png', normal]]) {
    const png = decodePng(name);
    assert.deepEqual([png.w, png.h], [atlas.meta.size.w, atlas.meta.size.h], name);
    assert.equal(atlas.meta.image.endsWith(name.replace('color', 'surface-lighting').replace('normal', 'surface-lighting.normal')), true, `${name} is the image the atlas names`);
  }
});

test('the atlas says the normal image is green up, and the pixels agree: the top of the dome tilts to +green, the left to -red', () => {
  assert.equal(normal.meta.normalEncoding.green, 'up');
  assert.deepEqual(normal.meta.normalEncoding.flat, [128, 128, 255]);
  const png = decodePng('normal.png');
  // Frame 1 starts at x = 30 and is trimmed by (1, 1); the dome is centred on cell pixel (9, 14) with radius 5.
  const frame = color.frames[1], px = (cx, cy) => png.at(frame.frame.x + cx - frame.spriteSourceSize.x, frame.frame.y + cy - frame.spriteSourceSize.y);
  const [, top] = px(9, 10), [, bottom] = px(9, 18), [leftR] = px(5, 14), [rightR] = px(13, 14);
  assert.ok(top > 150 && bottom < 106, `green: top ${top}, bottom ${bottom}`);
  assert.ok(leftR < 106 && rightR > 150, `red: left ${leftR}, right ${rightR}`);
  assert.deepEqual(png.at(frame.frame.x + 1, frame.frame.y + 1).slice(0, 3), [128, 128, 255], 'a flat surface (the back wall) is 128 / 128 / 255');
});
