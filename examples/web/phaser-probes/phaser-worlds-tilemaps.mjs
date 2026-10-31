// Purpose: reproduce the tilemap and layer claims in skills/phaser-worlds/references/tilemap-data-and-formats.md and
//          world-streaming-and-layers.md on Phaser 4.2.1.
// Run:     node phaser-worlds-tilemaps.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing check means a Phaser upgrade changed that behaviour.
// Covers:  GPU layers honour only flipX/flipY (Tiled rotations and vertical flips draw wrong), CPU tile animation needs startTime,
//          Layer and Container alpha do not reach tilemap layers, CPU culling (scroll factor, rotation, container), one layer per
//          LayerData, margin and spacing, GPU layer position doubling, GPU layer scroll factor, per-tile memory and regeneration cost,
//          external tilesets and compressed layers in Tiled JSON, the createFromObjects sortByY quirk.
import { startProbe } from './phaser-worlds-lib.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [host, ...args] = process.argv.slice(2);
const mutation = args.length === 2 && args[0] === '--mutation' ? args[1] : null;
const evidence = await mkdtemp(join(tmpdir(), 'phaser-tilemap-evidence-'));
const report = { probe: 'tilemap-orientations', evidence, mutation, passed: false, results: [], rows: [], errors: [], cleanup: {} };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFile(join(evidence, name), JSON.stringify(value, null, 2));
const bounded = async (promise, label, ms = 15000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]); }
  finally { clearTimeout(timer); }
};
let p;
try {
report.sources = { probe: hash(await readFile(new URL(import.meta.url))), helper: hash(await readFile(new URL('./phaser-worlds-lib.mjs', import.meta.url))), phaser: {} };
assert(host && (!args.length || mutation === 'wrong-expected'), 'Usage: node phaser-worlds-tilemaps.mjs <host> [--mutation wrong-expected]');
const require = createRequire(join(resolve(host), 'package.json'));
assert.equal(require('phaser/package.json').version, '4.2.1');
const sourceNames = ['dist/phaser.js', 'src/math/Vector2.js', 'src/tilemaps/Tile.js', 'src/tilemaps/Tilemap.js', 'src/tilemaps/ObjectHelper.js', 'src/tilemaps/parsers/tiled/ParseJSONTiled.js', 'src/tilemaps/parsers/tiled/ParseTileLayers.js', 'src/tilemaps/parsers/tiled/ParseObject.js', 'src/tilemaps/parsers/tiled/BuildTilesetIndex.js', 'src/tilemaps/components/IsometricTileToWorldXY.js', 'src/tilemaps/components/StaggeredTileToWorldXY.js', 'src/tilemaps/components/HexagonalTileToWorldXY.js', 'src/tilemaps/components/HexagonalCullBounds.js', 'src/tilemaps/components/StaggeredCullBounds.js', 'src/renderer/webgl/renderNodes/transformer/TransformerTile.js'];
for (const name of sourceNames) report.sources.phaser[name] = hash(await readFile(join(dirname(require.resolve('phaser/package.json')), name)));
await save('sources.json', report.sources);
p = await startProbe(host, {
  width: 240, height: 120,
  startupTimeout: 20000,
  game: { pixelArt: true },
  setup: `
    const quad = scene.textures.createCanvas('quad', 16, 8); const q = quad.context;      // tile 0: TL red, TR green, BL blue, BR yellow
    q.fillStyle = '#f00'; q.fillRect(0, 0, 4, 4); q.fillStyle = '#0f0'; q.fillRect(4, 0, 4, 4);
    q.fillStyle = '#00f'; q.fillRect(0, 4, 4, 4); q.fillStyle = '#ff0'; q.fillRect(4, 4, 4, 4);
    q.fillStyle = '#fff'; q.fillRect(8, 0, 8, 8); quad.refresh();
    const rg = scene.textures.createCanvas('rg', 16, 8); rg.context.fillStyle = '#f00'; rg.context.fillRect(0, 0, 8, 8);
    rg.context.fillStyle = '#0f0'; rg.context.fillRect(8, 0, 8, 8); rg.refresh();           // tile 0 red, tile 1 green
    const ms = scene.textures.createCanvas('ms', 20, 10); const m = ms.context;             // margin 1, spacing 2, grey gutters
    m.fillStyle = '#808080'; m.fillRect(0, 0, 20, 10); m.fillStyle = '#f00'; m.fillRect(1, 1, 8, 8);
    m.fillStyle = '#0f0'; m.fillRect(11, 1, 8, 8); ms.refresh();
    const px = scene.textures.createCanvas('px', 4, 4); px.context.fillStyle = '#fff'; px.context.fillRect(0, 0, 4, 4); px.refresh();
    window.rgb = (a) => a.slice(0, 3).join(',');
  `,
});
report.renderer = p.renderer;
report.browser = p.page.context().browser().version();
report.sources.loadedPhaserSha256 = hash(await readFile(require.resolve('phaser')));
await save('sources.json', report.sources);
const originalCheck = p.check;
p.check = (name, ok, detail) => { report.results.push({ name, ok: !!ok, detail }); originalCheck(name, ok, detail); };
const originalFrames = p.frames, originalPixel = p.pixel;
p.frames = (n) => bounded(originalFrames(n), 'completed frame');
p.pixel = (x, y) => bounded(originalPixel(x, y), 'snapshot pixel');
const key = { '255,0,0': 'R', '0,255,0': 'G', '0,0,255': 'B', '255,255,0': 'Y', '0,0,0': '.' };
const letter = (px) => key[px.slice(0, 3).join(',')] ?? '?';
const make = (src) => bounded(p.page.evaluate(src), 'native evaluation');

// 1. Tiled flip flags: CPU layers are right; GPU layers keep only flipX/flipY.
await make(`(() => {
  const H = 0x80000000, V = 0x40000000, D = 0x20000000;
  const data = [1, (1 | H) >>> 0, (1 | V) >>> 0, (1 | D) >>> 0, (1 | H | V) >>> 0];
  scene.cache.tilemap.add('flips', { format: Phaser.Tilemaps.Formats.TILED_JSON, data: { width: 5, height: 1, tilewidth: 8, tileheight: 8, infinite: false, orientation: 'orthogonal', renderorder: 'right-down', type: 'map', version: '1.10',
    layers: [{ id: 1, name: 'g', type: 'tilelayer', x: 0, y: 0, width: 5, height: 1, opacity: 1, visible: true, data }],
    tilesets: [{ firstgid: 1, name: 'quad', image: 'quad', imagewidth: 16, imageheight: 8, tilewidth: 8, tileheight: 8, margin: 0, spacing: 0, columns: 2, tilecount: 2 }] } });
  for (const gpu of [false, true]) {
    const map = scene.make.tilemap({ key: 'flips' });
    const set = map.addTilesetImage('quad', 'quad', 8, 8, 0, 0);
    window[gpu ? 'gpuFlips' : 'cpuFlips'] = map.createLayer('g', set, 0, 0, gpu).setVisible(false);
  }
})()`);
const quadrants = async () => {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const row = [];
    for (const [dx, dy] of [[1, 1], [6, 1], [1, 6], [6, 6]]) row.push(letter(await p.pixel(i * 8 + dx, dy)));
    out.push(row.join(''));
  }
  return out;
};
await make(`cpuFlips.setVisible(true)`); await p.frames(2);
const cpuFlips = await quadrants();
await make(`cpuFlips.setVisible(false); gpuFlips.setVisible(true)`); await p.frames(2);
const gpuFlips = await quadrants();
await make(`cpuFlips.destroy(); gpuFlips.destroy()`);
p.check('CPU layer draws none, H, V, anti-diagonal and 180-degree Tiled flips correctly', JSON.stringify(cpuFlips) === JSON.stringify(['RGBY', 'GRYB', 'BYRG', 'RBGY', 'YBGR']), cpuFlips);
p.check('GPU layer draws none and H correctly but ignores the V, diagonal and 180-degree rotations', JSON.stringify(gpuFlips) === JSON.stringify(['RGBY', 'GRYB', 'GRYB', 'GRYB', 'RGBY']), gpuFlips);

// 2. Hand-built tile animation on a CPU layer needs startTime on every frame.
await make(`(() => {
  const mk = (withStart, x) => {
    const map = scene.make.tilemap({ data: [[0, 0]], tileWidth: 8, tileHeight: 8 });
    const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
    const frames = [{ tileid: 0, duration: 100 }, { tileid: 1, duration: 100 }];
    if (withStart) frames.forEach((f, i) => { f.startTime = i * 100; });
    set.tileData[0] = { animation: frames, animationDuration: 200 };
    map.createLayer(0, set, x, 20, false);
  };
  mk(true, 0); mk(false, 40);
})()`);
const seen = { withStart: new Set(), without: new Set() };
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 55));
  seen.withStart.add(letter(await p.pixel(4, 24)));
  seen.without.add(letter(await p.pixel(44, 24)));
}
p.check('with startTime the CPU layer alternates red and green', seen.withStart.has('R') && seen.withStart.has('G'), [...seen.withStart]);
p.check('without startTime the animated tile is not drawn at all', seen.without.size === 1 && seen.without.has('.'), [...seen.without]);
await make(`scene.children.list.filter((o) => o.isTilemap).forEach((o) => o.destroy())`);

// 3. Alpha: Layer and Container alpha do not fade tilemap layers; the layer's own alpha does.
await make(`(() => {
  const mk = (gpu, x) => { const map = scene.make.tilemap({ data: [[1, 1]], tileWidth: 8, tileHeight: 8 }); const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0); return map.createLayer(0, set, x, 0, gpu); };
  const cpuInLayer = mk(false, 0); const gpuInContainer = mk(true, 0); const own = mk(false, 100);
  const imgInLayer = scene.add.image(180, 4, 'px').setOrigin(0).setScale(4);
  scene.add.layer([cpuInLayer, imgInLayer]).setAlpha(0.5);
  scene.add.container(60, 0, [gpuInContainer]).setAlpha(0.5);
  own.setAlpha(0.5);
})()`);
await p.frames(2);
const cpuInLayer = await p.pixel(4, 4);
const gpuInContainer = await p.pixel(64, 4);
const ownAlpha = await p.pixel(104, 4);
const imageInLayer = await p.pixel(182, 4);
p.check('Layer alpha 0.5 leaves a CPU tilemap layer fully opaque', cpuInLayer[1] === 255, cpuInLayer);
p.check('Container alpha 0.5 leaves a GPU tilemap layer fully opaque', gpuInContainer[1] === 255, gpuInContainer);
p.check('the tilemap layer own alpha 0.5 does fade it', Math.abs(ownAlpha[1] - 128) <= 4, ownAlpha);
p.check('Layer alpha 0.5 does fade an Image in the same Layer', Math.abs(imageInLayer[1] - 128) <= 4 || Math.abs(imageInLayer[0] - 128) <= 4, imageInLayer);
await make(`scene.children.list.slice().forEach((o) => o.destroy())`);

// 4. CPU culling: tilesDrawn / tilesTotal; scroll factor, rotation, container, layer.
const cull = await make(`(async () => {
  const next = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  const data = []; for (let y = 0; y < 100; y++) data.push(new Array(100).fill(1));
  const map = scene.make.tilemap({ data, tileWidth: 8, tileHeight: 8 });
  const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
  const layer = map.createLayer(0, set, 0, 400, false);
  const cam = scene.cameras.main; cam.setScroll(0, 400); await next();
  const normal = layer.tilesDrawn;
  layer.setScrollFactor(0.5); await next(); const parallax = layer.tilesDrawn; layer.setScrollFactor(1);
  cam.setRotation(0.6); await next(); const rotated = layer.tilesDrawn; cam.setRotation(0);
  layer.destroy();
  const map2 = scene.make.tilemap({ data: data.slice(0, 20).map((r) => r.slice(0, 20)), tileWidth: 8, tileHeight: 8 });
  const set2 = map2.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
  const inLayerLayer = map2.createLayer(0, set2, 2560, 0, false);
  const holder = scene.add.layer([inLayerLayer]); cam.setScroll(2560, 0); await next();
  const inLayer = inLayerLayer.tilesDrawn;
  holder.remove(inLayerLayer); scene.sys.displayList.add(inLayerLayer);
  const box = scene.add.container(2560, 0, [inLayerLayer]); inLayerLayer.setPosition(0, 0); await next();
  const inContainer = inLayerLayer.tilesDrawn;
  cam.setScroll(0, 0); box.destroy(); holder.destroy();
  return { total: 10000, normal, parallax, rotated, inLayer, inContainer };
})()`);
p.check('a CPU layer draws only the tiles in worldView (+1 tile padding)', cull.normal > 0 && cull.normal < 600, cull);
p.check('a CPU layer with scrollFactor 0.5 draws every tile every frame', cull.parallax === cull.total, cull);
p.check('camera rotation does not change which tiles are culled', cull.rotated === cull.normal, cull);
p.check('a CPU layer positioned at x 2560 inside a Layer is culled correctly', cull.inLayer > 0, cull);
p.check('the same layer at (0,0) inside a Container at x 2560 draws nothing (culled as if at the origin)', cull.inContainer === 0, cull);

// 5. One view per LayerData; margin and spacing on both layer types; GPU position doubling and scroll factor.
const misc = await make(`(() => {
  const map = scene.make.tilemap({ data: [[0, 1]], tileWidth: 8, tileHeight: 8 });
  const set = map.addTilesetImage('ms', 'ms', 8, 8, 1, 2);
  map.createLayer(0, set, 0, 0, false);
  const second = map.createLayer(0, set, 0, 0, false);
  const map2 = scene.make.tilemap({ data: [[0, 1]], tileWidth: 8, tileHeight: 8 });
  const set2 = map2.addTilesetImage('ms', 'ms', 8, 8, 1, 2);
  map2.createLayer(0, set2, 0, 20, true);
  return { secondIsNull: second === null, columns: set.columns };
})()`);
await p.frames(2);
const px = async (x, y) => letter(await p.pixel(x, y));
p.check('createLayer twice for one LayerData returns null', misc.secondIsNull, misc);
p.check('margin 1 and spacing 2 pick the right tiles on a CPU layer', (await px(4, 4)) === 'R' && (await px(12, 4)) === 'G', null);
p.check('margin 1 and spacing 2 pick the right tiles on a GPU layer', (await px(4, 44)) === 'R' && (await px(12, 44)) === 'G', null);
p.check('a GPU layer created at y 20 is drawn at y 40 (position applied twice)', (await px(4, 24)) === '.', null);
await make(`scene.children.list.slice().forEach((o) => o.destroy())`);
await make(`(() => {
  const map = scene.make.tilemap({ data: [[0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]], tileWidth: 8, tileHeight: 8 });
  const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
  map.createLayer(0, set, 0, 0, true).setScrollFactor(0.5);
  scene.cameras.main.setScroll(16, 0);
})()`);
await p.frames(3);
p.check('a GPU layer honours scrollFactor (camera 16 px, factor 0.5: shifted 8 px)', (await px(6, 4)) === 'R' && (await px(20, 4)) === 'G', null);
await make(`scene.cameras.main.setScroll(0, 0); scene.children.list.slice().forEach((o) => o.destroy())`);

// 6. Memory and regeneration cost per tile (JS heap, CPU-side only).
const mem = await make(`(async () => {
  const rows = [];
  for (const n of [32, 256, 512]) {
    gc(); await new Promise((r) => setTimeout(r, 50));
    const h0 = performance.memory.usedJSHeapSize;
    const data = []; for (let y = 0; y < n; y++) data.push(new Array(n).fill(0));
    const map = scene.make.tilemap({ data, tileWidth: 8, tileHeight: 8 });
    const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
    const layer = map.createLayer(0, set, 0, 0, true);
    gc(); await new Promise((r) => setTimeout(r, 50));
    const bytes = (performance.memory.usedJSHeapSize - h0) / (n * n);
    const t = []; for (let i = 0; i < 5; i++) { const a = performance.now(); layer.generateLayerDataTexture(); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    rows.push({ tiles: n * n, bytesPerTile: Math.round(bytes), regenMs: +t[2].toFixed(2) });
    layer.destroy(); map.destroy();
  }
  return rows;
})()`);
p.check('a tilemap holds roughly 100 to 400 bytes of JS heap per tile, GPU layer or not', mem[1].bytesPerTile > 100 && mem[1].bytesPerTile < 400, mem);
p.check('regenerating a GPU layer data texture grows with the tile count', mem[2].regenMs > mem[0].regenMs, mem);
console.error('per-tile cost (this machine, comparison only):', JSON.stringify(mem));

// 7. Tiled JSON limits and the createFromObjects quirk.
const tiled = await make(`(() => {
  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(String(a[0]));
  const base = { width: 2, height: 1, tilewidth: 8, tileheight: 8, infinite: false, orientation: 'orthogonal', renderorder: 'right-down', type: 'map', version: '1.10' };
  const layer = (extra) => Object.assign({ id: 1, name: 'g', type: 'tilelayer', width: 2, height: 1, opacity: 1, visible: true, x: 0, y: 0, data: [1, 1] }, extra);
  const ts = { firstgid: 1, name: 'rg', image: 'rg', imagewidth: 16, imageheight: 8, tilewidth: 8, tileheight: 8, margin: 0, spacing: 0, columns: 2, tilecount: 2 };
  scene.cache.tilemap.add('ext', { format: 1, data: Object.assign({}, base, { layers: [layer({})], tilesets: [{ firstgid: 1, source: 'tiles.tsj' }] }) });
  let extThrew = null; try { scene.make.tilemap({ key: 'ext' }); } catch (e) { extThrew = e.constructor.name; }
  scene.cache.tilemap.add('zl', { format: 1, data: Object.assign({}, base, { layers: [layer({ encoding: 'base64', compression: 'zlib', data: 'eJxjYAAAAAIAAQ==' })], tilesets: [ts] }) });
  const zl = scene.make.tilemap({ key: 'zl' });
  scene.cache.tilemap.add('obj', { format: 1, data: Object.assign({}, base, { layers: [layer({ data: [0, 0] }), { id: 2, name: 'o', type: 'objectgroup', objects: [{ id: 1, name: 'b', x: 0, y: 30, width: 4, height: 4 }, { id: 2, name: 'a', x: 0, y: 10, width: 4, height: 4 }, { id: 3, name: 'c', x: 0, y: 20, width: 4, height: 4 }] }], tilesets: [ts] }) });
  const objMap = scene.make.tilemap({ key: 'obj' });
  const plain = objMap.createFromObjects('o', {}).map((s) => s.name);
  const viaConfig = objMap.createFromObjects('o', { sortByY: true }).map((s) => s.name);
  console.warn = warn;
  return { warns, extThrew, zlLayers: zl.layers.length, plain, viaConfig };
})()`);
p.check('an external tileset warns, then parsing throws', tiled.warns.some((w) => /External tilesets unsupported/.test(w)) && tiled.extThrew === 'TypeError', tiled);
p.check('a compressed layer is skipped with a warning and the map has no layers', tiled.warns.some((w) => /compression is unsupported/.test(w)) && tiled.zlLayers === 0, tiled);
p.check('createFromObjects ignores sortByY passed inside the config object', JSON.stringify(tiled.plain) === JSON.stringify(tiled.viaConfig), tiled);

// 8. Isometric and staggered maps render on CPU layers at the positions tileToWorldXY reports.
const orient = await make(`(() => {
  const out = {};
  for (const [orientation, extra] of [['isometric', {}], ['staggered', { staggeraxis: 'y', staggerindex: 'odd' }]]) {
    const json = Object.assign({ width: 4, height: 4, tilewidth: 16, tileheight: 8, infinite: false, orientation, renderorder: 'right-down', type: 'map', version: '1.10',
      layers: [{ id: 1, name: 'g', type: 'tilelayer', x: 0, y: 0, width: 4, height: 4, opacity: 1, visible: true, data: new Array(16).fill(1) }],
      tilesets: [{ firstgid: 1, name: 'rg', image: 'rg', imagewidth: 16, imageheight: 8, tilewidth: 8, tileheight: 8, margin: 0, spacing: 0, columns: 2, tilecount: 2 }] }, extra);
    scene.cache.tilemap.add(orientation, { format: 1, data: json });
    const map = scene.make.tilemap({ key: orientation });
    const set = map.addTilesetImage('rg', 'rg', 8, 8, 0, 0);
    const layer = map.createLayer('g', set, 100, 20, false).setVisible(false);
    out[orientation] = { layer, corners: [[0, 0], [3, 0], [0, 3], [3, 3]].map(([x, y]) => { const w = layer.tileToWorldXY(x, y); return [w.x, w.y]; }), orientation: map.orientation };
  }
  window.orient = out;
  return { iso: out.isometric.corners, stag: out.staggered.corners, codes: [out.isometric.orientation, out.staggered.orientation] };
})()`);
for (const name of ['isometric', 'staggered']) {
  await make(`orient.isometric.layer.setVisible(false); orient.staggered.layer.setVisible(false); orient.${name}.layer.setVisible(true)`);
  await p.frames(2);
  const spots = orient[name === 'isometric' ? 'iso' : 'stag'];
  const hits = [];
  for (const [x, y] of spots) hits.push(await px(Math.round(x) + 4, Math.round(y) + 4));
  p.check(`a ${name} CPU layer draws its corner tiles where tileToWorldXY says`, hits.every((h) => h === 'R'), { spots, hits });
}
p.check('Tiled orientation maps to Phaser orientation 1 (isometric) and 2 (staggered)', orient.codes[0] === 1 && orient.codes[1] === 2, orient.codes);

// 8b. Independent finite orientation fixtures. These numbers are authored inputs,
// not values obtained by calling Phaser's coordinate function to choose sample points.
// Tile top-left anchors follow Tiled 1.11.2 layout; the hex coordinate API's declared
// anchor is the tile centre. Isometric origin is explicitly the (0,0) diamond, without
// Tiled's map-width centring offset. The observed source-boundary columns are separately
// calculated from 4.2.1 Tile.updatePixelXY / *TileToWorldXY, and never imply format support.
const points = [[0, 0], [2, 1], [1, 2], [3, 3]];
const stagOdd = [[0, 0], [40, 8], [16, 16], [56, 24]];
const hexYOddAPI = [[8, 8], [48, 20], [24, 32], [64, 44]];
const hexYEvenAPI = [[24, 8], [48, 20], [40, 32], [64, 44]];
const hexXOddAPI = [[8, 8], [32, 40], [20, 32], [44, 64]];
const definitions = [
  ['orthogonal', null, null, null, [[0, 0], [32, 16], [16, 32], [48, 48]]],
  ['isometric', null, null, null, [[0, 0], [8, 24], [-8, 24], [0, 48]]],
  ['staggered', 'y', 'odd', null, stagOdd],
  ['staggered', 'y', 'even', null, [[8, 0], [32, 8], [24, 16], [48, 24]]],
  ['staggered', 'x', 'odd', null, [[0, 0], [16, 16], [8, 40], [24, 56]]],
  ['staggered', 'x', 'even', null, [[0, 8], [16, 24], [8, 32], [24, 48]]],
  ['hexagonal', 'y', 'odd', 8, [[0, 0], [40, 12], [16, 24], [56, 36]]],
  ['hexagonal', 'y', 'even', 8, [[8, 0], [32, 12], [24, 24], [48, 36]]],
  ['hexagonal', 'x', 'odd', 8, [[0, 0], [24, 16], [12, 40], [36, 56]]],
  ['hexagonal', 'x', 'even', 8, [[0, 8], [24, 24], [12, 32], [36, 48]]],
  ['hexagonal', 'y', 'odd', 4, [[0, 0], [40, 10], [16, 20], [56, 30]]],
  ['hexagonal', 'y', 'even', 4, [[8, 0], [32, 10], [24, 20], [48, 30]]],
  ['hexagonal', 'x', 'odd', 4, [[0, 0], [20, 16], [10, 40], [30, 56]]],
  ['hexagonal', 'x', 'even', 4, [[0, 8], [20, 24], [10, 32], [30, 48]]],
];
const fixture = {
  format: 'Tiled 1.11.2 JSON; finite embedded tilesets, uncompressed numeric GIDs',
  size: [4, 4], tileSize: [16, 16], artSize: [8, 8], layerPosition: [100, 20], points,
  gids: [1, 2, 17, 18], firstgids: [1, 17], colors: [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]],
  cameras: [{ name: 'fixed', scroll: [0, 0] }, { name: 'translated', scroll: [24, 8] }],
  restrictions: { viewport: [240, 120], zoom: 1, rotation: 0, scale: 1, scrollFactor: 1, parent: null, cullPadding: [1, 1], effects: [], collision: 'unverified', inverseCoordinates: 'unverified', edgeAndOffscreenCulling: 'unverified', zoomRotationParallaxParentCulling: 'unverified' },
  rows: definitions.map(([orientation, axis, index, sideLength, expectedPaint]) => {
    const hex = orientation === 'hexagonal';
    const expectedAPI = expectedPaint.map(([x, y]) => hex ? [x + 8, y + 8] : [x, y]);
    const sourcePaint = orientation === 'staggered' ? stagOdd : hex && index === 'even'
      ? expectedPaint.map(([x, y]) => axis === 'y' ? [x - 8, y] : [x, y - 8]) : expectedPaint;
    const sourceAPI = hex ? axis === 'y' ? index === 'odd' ? hexYOddAPI : hexYEvenAPI
      : index === 'odd' ? hexXOddAPI : [['undefined', 'undefined'], ['undefined', 'undefined'], ['undefined', 'undefined'], ['undefined', 'undefined']]
      : orientation === 'staggered' ? stagOdd : expectedAPI;
    return { id: [orientation, axis, index, sideLength].filter(v => v !== null).join('-'), orientation, axis, index, sideLength,
      expectedPaint, expectedAPI, sourcePaint, sourceAPI,
      expectedDisposition: (!hex && (orientation !== 'staggered' || (axis === 'y' && index === 'odd'))) || (hex && axis === 'y' && index === 'odd' && sideLength === 8) ? 'supported' : 'mismatched' };
  }),
};
// Mutation changes the independent oracle, not the implementation or observed result.
if (mutation === 'wrong-expected') fixture.rows[0].expectedAPI = fixture.rows[0].expectedAPI.map(([x, y], i) => [x + (i === 1 ? 1 : 0), y]);
await save('fixture.json', fixture);
report.fixtureSha256 = hash(await readFile(join(evidence, 'fixture.json')));
report.boundaries = fixture.restrictions;
await make(`(() => {
  scene.children.list.slice().forEach(o => o.destroy());
  scene.cameras.main.setScroll(0, 0);
  const by = scene.textures.createCanvas('orientation-by', 16, 8);
  by.context.fillStyle = '#00f'; by.context.fillRect(0, 0, 8, 8);
  by.context.fillStyle = '#ff0'; by.context.fillRect(8, 0, 8, 8); by.refresh();
  by.add(0, 0, 0, 0, 8, 8); by.add(1, 0, 8, 0, 8, 8);
  window.orientationOwned = { maps: [], objects: [], keys: [] };
})()`);
const capture = async (stem) => {
  const shot = await make(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('snapshot frame timed out')), 5000);
    game.renderer.snapshot(image => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0);
        const rgba = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
        canvas.width = canvas.height = 0; clearTimeout(timer);
        resolve({ png: image.src.split(',')[1], rgba, width: image.width, height: image.height });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  })`);
  const png = Buffer.from(shot.png, 'base64'), rgba = Buffer.from(shot.rgba);
  await writeFile(join(evidence, `${stem}.png`), png);
  await writeFile(join(evidence, `${stem}.rgba`), rgba);
  return { rgba, artifact: { png: `${stem}.png`, rgba: `${stem}.rgba`, width: shot.width, height: shot.height, pngSha256: hash(png), rgbaSha256: hash(rgba) } };
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const compareFrame = (rgba, rectangles) => {
  let mismatchedPixels = 0;
  for (let y = 0; y < 120; y++) for (let x = 0; x < 240; x++) {
    const region = rectangles.findLast(r => x >= r.x && x < r.x + 8 && y >= r.y && y < r.y + 8);
    const color = region?.color ?? [0, 0, 0, 255], i = (y * 240 + x) * 4;
    if (color.some((v, c) => rgba[i + c] !== v)) mismatchedPixels++;
  }
  return mismatchedPixels;
};
for (const row of fixture.rows) {
  const result = { id: row.id, declared: row, frames: [], disposition: 'unverified' };
  report.rows.push(result);
  const data = new Array(16).fill(0);
  points.forEach(([x, y], i) => { data[y * 4 + x] = fixture.gids[i]; });
  const json = {
    width: 4, height: 4, tilewidth: 16, tileheight: 16, infinite: false, orientation: row.orientation,
    staggeraxis: row.axis, staggerindex: row.index, hexsidelength: row.sideLength,
    renderorder: 'right-down', type: 'map', version: '1.10', tiledversion: '1.11.2',
    layers: [{ id: 1, name: 'ground', type: 'tilelayer', x: 0, y: 0, width: 4, height: 4, opacity: 1, visible: true, data },
      { id: 2, name: 'objects', type: 'objectgroup', objects: [
        { id: 1, name: 'rectangle', x: 24, y: 8, width: 8, height: 8, rotation: 0, visible: true },
        { id: 2, name: 'tile', gid: 18, x: 48, y: 16, width: 8, height: 8, rotation: 0, visible: true },
      ] }],
    tilesets: [{ firstgid: 1, name: 'rg', image: 'rg' }, { firstgid: 17, name: 'orientation-by', image: 'orientation-by' }]
      .map(ts => ({ ...ts, imagewidth: 16, imageheight: 8, tilewidth: 8, tileheight: 8, margin: 0, spacing: 0, columns: 2, tilecount: 2 })),
  };
  await save(`${row.id}-input.json`, json);
  result.inputSha256 = hash(await readFile(join(evidence, `${row.id}-input.json`)));
  result.parsed = await bounded(p.page.evaluate(({ json, id, points }) => {
    const key = `orientation-${id}`; scene.cache.tilemap.add(key, { format: 1, data: json }); orientationOwned.keys.push(key);
    const map = scene.make.tilemap({ key }); orientationOwned.maps.push(map);
    const sets = [map.addTilesetImage('rg', 'rg', 8, 8, 0, 0), map.addTilesetImage('orientation-by', 'orientation-by', 8, 8, 0, 0)];
    const layer = map.createLayer('ground', sets, 100, 20, false);
    const objects = map.createFromObjects('objects', [{ name: 'rectangle', key: 'px' }, { name: 'tile' }]);
    objects.forEach(o => o.setVisible(false)); orientationOwned.objects.push(...objects);
    window.orientationCurrent = { map, layer, objects };
    return { code: map.orientation, tiles: points.map(([x, y]) => { const t = layer.getTileAt(x, y); return { x, y, index: t.index, pixel: [t.pixelX, t.pixelY], tileset: layer.gidMap[t.index].name }; }),
      rawObjects: map.getObjectLayer('objects').objects.map(o => ({ name: o.name, x: o.x, y: o.y, gid: o.gid ?? null })),
      objects: objects.map(o => ({ name: o.name, x: o.x, y: o.y, texture: o.texture.key, frame: o.frame.name })) };
  }, { json, id: row.id, points }), 'create orientation fixture');
  for (const camera of fixture.cameras) {
    await bounded(p.page.evaluate(scroll => { scene.cameras.main.setScroll(...scroll); }, camera.scroll), 'set fixture camera');
    await p.frames(2);
    const state = await bounded(p.page.evaluate(points => {
      const { layer } = orientationCurrent, c = scene.cameras.main;
      return { coordinates: points.map(([x, y]) => { const p = layer.tileToWorldXY(x, y); return [p.x, p.y].map(v => Number.isFinite(v) ? v : String(v)); }),
        tilesDrawn: layer.tilesDrawn, tilesTotal: layer.tilesTotal, culled: layer.culledTiles.map(t => [t.x, t.y, t.index]),
        camera: { scroll: [c.scrollX, c.scrollY], zoom: c.zoom, rotation: c.rotation, worldView: { x: c.worldView.x, y: c.worldView.y, width: c.worldView.width, height: c.worldView.height } },
        layer: { position: [layer.x, layer.y], scale: [layer.scaleX, layer.scaleY], scrollFactor: [layer.scrollFactorX, layer.scrollFactorY], skipCull: layer.skipCull, cullPadding: [layer.cullPaddingX, layer.cullPaddingY] } };
    }, points), 'observe native coordinates');
    const shot = await capture(`${row.id}-${camera.name}`);
    const paint = locations => locations.map(([x, y], i) => ({ x: 100 + x - camera.scroll[0], y: 20 + y - camera.scroll[1], color: fixture.colors[i] }));
    const frame = { name: camera.name, state, artifact: shot.artifact,
      coordinateMatches: equal(state.coordinates, row.expectedAPI.map(([x, y]) => [100 + x, 20 + y])),
      sourceCoordinateMatches: equal(state.coordinates, row.sourceAPI.map(([x, y]) => [typeof x === 'number' ? 100 + x : x, typeof y === 'number' ? 20 + y : y])),
      authoredPaintMismatches: compareFrame(shot.rgba, paint(row.expectedPaint)),
      sourcePaintMismatches: compareFrame(shot.rgba, paint(row.sourcePaint)) };
    result.frames.push(frame);
    await save(`${row.id}.json`, result); // Persist lossless frame and state before any check can abort.
    p.check(`${row.id} ${camera.name}: native source-boundary coordinates and full paint`, frame.sourceCoordinateMatches && frame.sourcePaintMismatches === 0, frame);
    p.check(`${row.id} ${camera.name}: four marked GIDs survive the native cull`, state.tilesDrawn === 4 && state.culled.length === 4 && fixture.gids.every(gid => state.culled.some(t => t[2] === gid)), state);
    if (row.expectedDisposition === 'supported') p.check(`${row.id} ${camera.name}: independent coordinate and paint witness`, frame.coordinateMatches && frame.authoredPaintMismatches === 0, frame);
  }
  await make(`orientationCurrent.layer.setVisible(false); orientationCurrent.objects.forEach(o => o.setVisible(true)); scene.cameras.main.setScroll(0, 0); void 0`);
  await p.frames(2);
  const objectShot = await capture(`${row.id}-objects`);
  const objectCenters = row.orientation === 'isometric' ? [[20, 36], [36, 60]] : [[28, 12], [52, 12]];
  result.objectEvidence = { artifact: objectShot.artifact, expectedCenters: objectCenters,
    coordinatesMatch: equal(result.parsed.objects.map(o => [o.x, o.y]), objectCenters),
    paintMismatches: compareFrame(objectShot.rgba, objectCenters.map(([x, y], i) => ({ x: x - 4, y: y - 4, color: i ? fixture.colors[3] : [255, 255, 255, 255] }))) };
  result.disposition = result.frames.every(f => f.coordinateMatches && f.authoredPaintMismatches === 0) ? 'supported' : 'mismatched';
  await save(`${row.id}.json`, result);
  p.check(`${row.id}: raw object coordinates, native origin conversion and second-tileset GID`,
    equal(result.parsed.rawObjects, [{ name: 'rectangle', x: 24, y: 8, gid: null }, { name: 'tile', x: 48, y: 16, gid: 18 }]) &&
    result.objectEvidence.coordinatesMatch && result.objectEvidence.paintMismatches === 0 && result.parsed.objects[1].texture === 'orientation-by' && result.parsed.objects[1].frame === 1,
    result.objectEvidence);
  p.check(`${row.id}: bounded disposition remains ${row.expectedDisposition}`, result.disposition === row.expectedDisposition, { actual: result.disposition, expected: row.expectedDisposition });
  await make(`orientationCurrent.objects.forEach(o => o.destroy()); orientationCurrent.map.destroy(); delete window.orientationCurrent; scene.cameras.main.setScroll(0, 0); void 0`);
}
report.verdict = report.rows.every(r => r.disposition === 'supported') ? 'validated' : 'partial';
report.unsupported = report.rows.filter(r => r.disposition !== 'supported').map(r => ({ id: r.id, reason: 'independent authored placement or declared coordinate anchor disagrees; source-boundary observations are not support' }));
} catch (error) {
  report.errors.push({ name: error.name, message: error.message, stack: error.stack, pageErrors: error.pageErrors, causes: error.errors?.map(e => ({ name: e.name, message: e.message, pageErrors: e.pageErrors })) });
  report.verdict = 'invalidated';
  process.exitCode = 1;
} finally {
  if (p) {
    report.errors.push(...p.errors.map(message => ({ name: 'pageerror', message })));
    try {
      report.cleanup.scene = await bounded(p.page.evaluate(() => {
        const c = scene.cameras.main;
        if (window.orientationOwned) {
          orientationOwned.objects.forEach(o => { if (o.scene) o.destroy(); });
          orientationOwned.maps.forEach(m => { if (m.scene) m.destroy(); });
          orientationOwned.keys.forEach(key => scene.cache.tilemap.remove(key));
        }
        scene.children.list.slice().forEach(o => o.destroy()); c.setScroll(0, 0).setZoom(1).setRotation(0);
        for (const key of ['quad', 'rg', 'ms', 'px', 'orientation-by']) if (scene.textures.exists(key)) scene.textures.remove(key);
        const result = { children: scene.children.length, scroll: [c.scrollX, c.scrollY], zoom: c.zoom, rotation: c.rotation,
          cachesRemoved: !window.orientationOwned || orientationOwned.keys.every(key => !scene.cache.tilemap.exists(key)),
          texturesRemoved: ['quad', 'rg', 'ms', 'px', 'orientation-by'].every(key => !scene.textures.exists(key)) };
        delete window.orientationOwned; delete window.orientationCurrent; game.destroy(true);
        return result;
      }), 'scene cleanup', 5000);
    } catch (error) { report.errors.push({ name: 'cleanup', message: error.message }); }
    const browser = p.page.context().browser();
    try { await bounded(browser.close(), 'browser cleanup', 10000); report.cleanup.browserClosed = !browser.isConnected(); }
    catch (error) { report.errors.push({ name: 'cleanup', message: error.message }); }
  }
  report.passed = !!p && !report.errors.length && report.results.every(r => r.ok) && report.rows.length === 14 && report.cleanup.browserClosed && report.cleanup.scene?.children === 0 && report.cleanup.scene?.cachesRemoved && report.cleanup.scene?.texturesRemoved && JSON.stringify(report.cleanup.scene?.scroll) === '[0,0]' && report.cleanup.scene?.zoom === 1 && report.cleanup.scene?.rotation === 0;
  if (!report.passed) process.exitCode = 1;
  report.checks = report.results.length;
  report.failed = report.results.filter(r => !r.ok).length;
  await save('report.json', report);
  console.log(JSON.stringify(report, null, 2));
}
