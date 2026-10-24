// Purpose: reproduce the tilemap and layer claims in skills/phaser-worlds/references/tilemap-data-and-formats.md and
//          world-streaming-and-layers.md on Phaser 4.2.1.
// Run:     node phaser-worlds-tilemaps.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing check means a Phaser upgrade changed that behaviour.
// Covers:  GPU layers honour only flipX/flipY (Tiled rotations and vertical flips draw wrong), CPU tile animation needs startTime,
//          Layer and Container alpha do not reach tilemap layers, CPU culling (scroll factor, rotation, container), one layer per
//          LayerData, margin and spacing, GPU layer position doubling, GPU layer scroll factor, per-tile memory and regeneration cost,
//          external tilesets and compressed layers in Tiled JSON, the createFromObjects sortByY quirk.
import { startProbe } from './phaser-worlds-lib.mjs';

const p = await startProbe(process.argv[2], {
  width: 240, height: 120,
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
const key = { '255,0,0': 'R', '0,255,0': 'G', '0,0,255': 'B', '255,255,0': 'Y', '0,0,0': '.' };
const letter = (px) => key[px.slice(0, 3).join(',')] ?? '?';
const make = (src) => p.page.evaluate(src);

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

await p.finish();
