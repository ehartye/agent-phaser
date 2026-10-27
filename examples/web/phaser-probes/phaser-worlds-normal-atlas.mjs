// Purpose: reproduce the paired-normal-atlas claims in skills/phaser-worlds/references/normal-mapped-sprites.md on Phaser 4.2.1:
//          the loader call for a colour atlas plus its normal image, frame correspondence, animation tags and the pivot, and which way a
//          lit sprite responds to a light when the normal image is "green up" (the agent-sprites export convention).
// Run:     node phaser-worlds-normal-atlas.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. Software rasteriser or GPU: the checks compare lit pixels with each other, never with a stored image.
// Needs:   tests/fixtures/normal-atlas/, a real agent-sprites surface-lighting export (three 32x24 poses): color.png, normal.png and the two atlas JSONs.
// Covers:  load.atlas(key, [color, normal], atlasJson); the normal image as dataSource; frame rectangles, trim and size shared with the atlas JSON;
//          createFromAseprite needing the JSON in cache.json and not knowing the pingpong_reverse direction; the pivot as setOrigin; light from the
//          left, right, above and below against the same sprite without a normal map; flipped-green and flipped-red controls that must reverse the response.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startProbe } from './phaser-worlds-lib.mjs';

const dir = new URL('../../../tests/fixtures/normal-atlas/', import.meta.url);
const read = (name) => readFileSync(fileURLToPath(new URL(name, dir)));
const files = { 'color.png': read('color.png'), 'normal.png': read('normal.png'), 'color.atlas.json': read('color.atlas.json') };
const atlas = JSON.parse(files['color.atlas.json']);

const p = await startProbe(process.argv[2], { game: { pixelArt: true } });
// The loader fetches over HTTP; serve the fixtures from a made-up origin so the call under test is the real load.atlas.
await p.page.route('http://fixtures.test/**', (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  const body = files[name];
  route.fulfill({ status: body ? 200 : 404, body: body ?? '', headers: { 'access-control-allow-origin': '*', 'content-type': name.endsWith('.png') ? 'image/png' : 'application/json' } });
});

// 1. The loader call, and what Phaser made of it.
const loaded = await p.page.evaluate(async () => {
  const base = 'http://fixtures.test/';
  await new Promise((done) => {
    scene.load.atlas('lit', [base + 'color.png', base + 'normal.png'], base + 'color.atlas.json');
    scene.load.atlas('flat', base + 'color.png', base + 'color.atlas.json');
    scene.load.json('litTags', base + 'color.atlas.json');
    scene.load.once('complete', done); scene.load.start();
  });
  const lit = scene.textures.get('lit'), flat = scene.textures.get('flat');
  const cut = (f) => ({ x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight, trimX: f.x, trimY: f.y, sourceW: f.realWidth, sourceH: f.realHeight });
  return {
    names: lit.getFrameNames(), normals: lit.dataSource.length, flatNormals: flat.dataSource.length,
    colorSize: [lit.source[0].width, lit.source[0].height], normalSize: lit.dataSource[0] ? [lit.dataSource[0].width, lit.dataSource[0].height] : null,
    frames: Object.fromEntries(lit.getFrameNames().map((n) => [n, cut(lit.get(n))])),
  };
});
const wantNames = atlas.frames.map((f) => f.filename);
p.check('load.atlas(key, [colorUrl, normalUrl], atlasUrl) loads every atlas frame once, with the normal image as dataSource[0]',
  JSON.stringify(loaded.names) === JSON.stringify(wantNames) && loaded.normals === 1 && loaded.flatNormals === 0, { names: loaded.names, normals: loaded.normals, flatNormals: loaded.flatNormals });
p.check('the normal image has the colour image size, so one set of frame rectangles addresses both',
  JSON.stringify(loaded.colorSize) === JSON.stringify(loaded.normalSize) && loaded.colorSize[0] === atlas.meta.size.w && loaded.colorSize[1] === atlas.meta.size.h, { colorSize: loaded.colorSize, normalSize: loaded.normalSize });
const mismatched = atlas.frames.filter((f) => {
  const got = loaded.frames[f.filename], s = f.spriteSourceSize;
  return !got || got.x !== f.frame.x || got.y !== f.frame.y || got.w !== f.frame.w || got.h !== f.frame.h || got.trimX !== s.x || got.trimY !== s.y || got.sourceW !== f.sourceSize.w || got.sourceH !== f.sourceSize.h;
}).map((f) => f.filename);
p.check('every frame rectangle, trim offset and source size in Phaser equals the atlas JSON', mismatched.length === 0, { mismatched, frames: atlas.frames.length });

// 2. Animation tags and the pivot.
const tags = await p.page.evaluate(async () => {
  const r = {};
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  r.beforeCache = scene.anims.createFromAseprite('lit').length; r.warned = warned; console.warn = warn;
  scene.cache.json.add('lit', scene.cache.json.get('litTags'));
  const made = scene.anims.createFromAseprite('lit'), a = made[0];
  r.tag = { count: made.length, key: a.key, frames: a.frames.map((f) => f.textureFrame), yoyo: a.yoyo };
  const play = async (anim) => {
    const spr = scene.add.sprite(100, 100, 'lit', '1').setLighting(true), seq = [];
    spr.on('animationstart', (_a, f) => seq.push(f.textureFrame)); spr.on('animationupdate', (_a, f) => seq.push(f.textureFrame));
    spr.play(anim); await new Promise((res) => spr.once('animationcomplete', res)); spr.destroy(); return seq;
  };
  r.fromTag = await play('sweep');
  scene.anims.remove('sweep');
  const hold = { 3: 75, 4: 125, 5: 200 };
  scene.anims.create({ key: 'sweep', frames: ['5', '4', '3', '4'].map((frame) => ({ key: 'lit', frame, duration: hold[frame] })) });
  r.listed = await play('sweep');
  scene.anims.remove('sweep');
  scene.anims.create({ key: 'sweep', frames: ['5', '4', '3'].map((frame) => ({ key: 'lit', frame, duration: hold[frame] })), yoyo: true });
  r.yoyo = await play('sweep');
  const spr = scene.add.sprite(100, 100, 'lit', '1');
  r.size = [spr.width, spr.height]; spr.setOrigin(16 / 32, 22 / 24); r.pivot = [spr.displayOriginX, spr.displayOriginY]; spr.destroy();
  return r;
});
const tag = atlas.meta.frameTags[0], pivot = atlas.meta.slices[0].keys[0].pivot;
p.check('createFromAseprite finds nothing until the atlas JSON is in cache.json under the texture key (load.atlas does not put it there)', tags.beforeCache === 0 && tags.warned === 1, { beforeCache: tags.beforeCache, warned: tags.warned });
p.check('the export pingpong_reverse tag becomes a plain forward animation over the same frames, which Phaser does not know how to reverse',
  tag.direction === 'pingpong_reverse' && tags.tag.count === 1 && tags.tag.key === tag.name && JSON.stringify(tags.tag.frames) === JSON.stringify(['3', '4', '5']) && tags.tag.yoyo === false && JSON.stringify(tags.fromTag) === JSON.stringify(['3', '4', '5']), { tag, made: tags.tag, played: tags.fromTag });
p.check('listing the frames yourself plays the authored C, B, A, B; yoyo: true would repeat the first frame at the end',
  JSON.stringify(tags.listed) === JSON.stringify(['5', '4', '3', '4']) && JSON.stringify(tags.yoyo) === JSON.stringify(['5', '4', '3', '4', '5']), { listed: tags.listed, yoyo: tags.yoyo });
p.check('a trimmed sprite is as large as the untrimmed cell, so the pivot is setOrigin(pivot.x / width, pivot.y / height)',
  tags.size[0] === atlas.frames[0].sourceSize.w && tags.size[1] === atlas.frames[0].sourceSize.h && tags.pivot[0] === pivot.x && tags.pivot[1] === pivot.y, { size: tags.size, pivot: tags.pivot, authored: pivot });

// Without a normal image there is nothing to compare: report what failed so far instead of crashing in the controls.
if (loaded.normals !== 1) { await p.finish(); process.exit(); }

// 3. Which way does the lit sprite respond? The cell is drawn at 6x. The orb is a dome at (9, 14) with radius 5: compare its halves.
const S = 6, OX = 100, OY = 70;
await p.page.evaluate(async ({ OX, OY, S }) => {
  scene.lights.enable(); scene.lights.setAmbientColor(0x303030);
  // Flipped controls: the same normal image with one channel inverted, as a texture of its own.
  const normal = scene.textures.get('lit').dataSource[0].image;
  const flipped = (channel) => {
    const c = document.createElement('canvas'); c.width = normal.width; c.height = normal.height;
    const g = c.getContext('2d'); g.drawImage(normal, 0, 0); const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) if (d.data[i + 3]) d.data[i + channel] = 255 - d.data[i + channel];
    g.putImageData(d, 0, 0); return c;
  };
  const colour = scene.textures.get('lit').source[0].image, json = scene.cache.json.get('litTags');
  scene.textures.addAtlas('flipG', colour, json, [flipped(1)]);
  scene.textures.addAtlas('flipR', colour, json, [flipped(0)]);
  window.variants = {};
  for (const key of ['lit', 'flat', 'flipG', 'flipR']) window.variants[key] = scene.add.sprite(OX, OY, key, '1').setOrigin(0, 0).setScale(S).setLighting(true).setVisible(false);
}, { OX, OY, S });
const lights = { left: [-150, 140], right: [600, 140], above: [200, -250], below: [200, 600] };
const response = await p.page.evaluate(async ({ OX, OY, S, lights }) => {
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else game.events.once('postrender', f); }; game.events.once('postrender', f); });
  const px = (x, y) => new Promise((res) => game.renderer.snapshotPixel(x, y, (c) => res(c.r + c.g + c.b)));
  const box = async (cx0, cx1, cy0, cy1) => { let sum = 0, n = 0; for (let cy = cy0; cy <= cy1; cy += 2) for (let cx = cx0; cx <= cx1; cx++) { sum += await px(OX + cx * S + S / 2, OY + cy * S + S / 2); n++; } return sum / n; };
  const out = {}; let lamp = null;
  for (const key of Object.keys(variants)) {
    for (const k of Object.keys(variants)) variants[k].setVisible(k === key);
    out[key] = {};
    for (const [dir, [x, y]] of Object.entries(lights)) {
      if (lamp) scene.lights.removeLight(lamp);
      lamp = scene.lights.addLight(x, y, 2000, 0xffffff, 2, 120);
      await frames(3);
      // left and right halves of the orb on its middle rows; top and bottom halves on its middle columns
      const L = await box(4, 7, 12, 16), R = await box(11, 14, 12, 16), T = await box(7, 11, 9, 12), B = await box(7, 11, 16, 19);
      out[key][dir] = { left: +(L / (L + R)).toFixed(3), top: +(T / (T + B)).toFixed(3) };
    }
  }
  scene.lights.removeLight(lamp); return out;
}, { OX, OY, S, lights });
// "swing": how far the share of light on one half moves between the two opposite lights. 0 = no response, 1 = all of it.
const swing = (v) => ({ horizontal: +(v.left.left - v.right.left).toFixed(3), vertical: +(v.above.top - v.below.top).toFixed(3) });
const sw = Object.fromEntries(Object.entries(response).map(([k, v]) => [k, swing(v)]));
p.check('with the green-up normal image, light from the left lights the left of the dome and light from the right the right (swing above 0.5)', sw.lit.horizontal > 0.5, sw.lit);
p.check('with the green-up normal image, light from above lights the top of the dome and light from below the bottom (swing above 0.35): no flip is needed', sw.lit.vertical > 0.35, sw.lit);
p.check('the same sprite without a normal image barely responds to the direction of the light (swings below 0.15: only distance changes)', Math.abs(sw.flat.horizontal) < 0.15 && Math.abs(sw.flat.vertical) < 0.15, sw.flat);
p.check('control: inverting the green channel reverses the vertical response and keeps the horizontal one', sw.flipG.vertical < -0.35 && sw.flipG.horizontal > 0.5, sw.flipG);
p.check('control: inverting the red channel reverses the horizontal response and keeps the vertical one', sw.flipR.horizontal < -0.5 && sw.flipR.vertical > 0.35, sw.flipR);

await p.finish();
