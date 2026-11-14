// Run: node phaser-verification-content-cost.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove, against real Phaser 4.2.1, the two "cost of content" counters that phaser-verification/references/performance.md
// describes and the chunk-visibility helper that phaser-worlds ships:
//   - texture memory: a PNG of a few kilobytes becomes a texture of width x height x 4 bytes, the in-page sum over
//     game.textures.list equals the offline sum of PNG headers, textures.remove gives the bytes back, and pixels copied out
//     once outlive the texture;
//   - view census: the number of objects the census calls "submitted" is the number the renderer's image transformer really
//     runs on, objects far off screen are all submitted, and hiding by chunk brings the submitted count down to the ring.
// Needs: phaser 4.2.1 and @playwright/test or playwright-core in the host project. A software renderer is enough: these are
// counts, not frame times. It does not measure the memory of a page or a device; see the reference for what is not known.
// Expected output: JSON with one result per check and "failed": 0; exit code 1 on a failure.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { startProbe } from './phaser-worlds-lib.mjs';
import { MIB, checkTextureBudget, measureFolder, measureTextures } from '../../../skills/phaser-verification/scripts/assets/texture-memory.mjs';
import { checkViewCensus, viewCensus } from '../../../skills/phaser-verification/scripts/assets/view-census.mjs';
import { createChunkVisibility } from '../../../skills/phaser-worlds/scripts/assets/chunk-visibility.mjs';

// A valid PNG of one flat RGBA colour. Flat pixels deflate to almost nothing, which is the point of check 1.
function flatPng(width, height, [r, g, b, a]) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x++) row.set([r, g, b, a], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sheets = { big: flatPng(2048, 2048, [200, 40, 40, 255]), wide: flatPng(1024, 256, [40, 200, 40, 255]) };
const folder = mkdtempSync(join(tmpdir(), 'phaser-content-cost-'));
for (const [name, bytes] of Object.entries(sheets)) writeFileSync(join(folder, `${name}.png`), bytes);

const p = await startProbe(process.argv[2], { width: 400, height: 300 });
try {
  await p.page.addScriptTag({ content: `window.measureTextures = ${measureTextures}; window.viewCensus = ${viewCensus}; window.createChunkVisibility = ${createChunkVisibility};` });

  // 1 to 4. Texture memory.
  const tex = await p.page.evaluate(async (uris) => {
    const wrappers = () => game.renderer.glTextureWrappers.length;
    const before = { report: measureTextures(game), wrappers: wrappers() };
    await new Promise((done) => {
      for (const [key, uri] of Object.entries(uris)) scene.load.image(key, uri);
      scene.load.once('complete', done);
      scene.load.start();
    });
    const loaded = { report: measureTextures(game), wrappers: wrappers(), failed: scene.load.totalFailed };
    // Copy the pixels out once, as a CPU painter would, then drop the texture.
    const image = scene.textures.get('wide').getSourceImage();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    canvas.width = canvas.height = 0;   // release the canvas backing store as well
    scene.textures.remove('wide');
    const afterOne = { report: measureTextures(game), wrappers: wrappers(), exists: scene.textures.exists('wide') };
    scene.textures.remove('big');
    const afterAll = { report: measureTextures(game), wrappers: wrappers() };
    return { before, loaded, afterOne, afterAll, kept: { length: pixels.data.length, first: Array.from(pixels.data.slice(0, 4)), last: Array.from(pixels.data.slice(-4)) } };
  }, Object.fromEntries(Object.entries(sheets).map(([key, bytes]) => [key, `data:image/png;base64,${bytes.toString('base64')}`])));

  const offline = measureFolder(folder);
  const added = tex.loaded.report.bytes - tex.before.report.bytes;
  const big = tex.loaded.report.textures.find((t) => t.key === 'big');
  p.check('texture-a-small-png-is-a-large-texture', sheets.big.length < 64 * 1024 && big && big.width === 2048 && big.height === 2048 && big.bytes === 16 * MIB && tex.loaded.failed === 0,
    { fileBytes: sheets.big.length, texture: big, ratio: Math.round((16 * MIB) / sheets.big.length) });
  p.check('texture-sum-grows-by-width-x-height-x-4-per-load', added === 2048 * 2048 * 4 + 1024 * 256 * 4 && tex.loaded.wrappers - tex.before.wrappers === 2,
    { addedBytes: added, addedWrappers: tex.loaded.wrappers - tex.before.wrappers, baselineBytes: tex.before.report.bytes, baselineKeys: tex.before.report.textures.map((t) => t.key) });
  p.check('texture-offline-png-header-sum-equals-the-loaded-sum', offline.bytes === added && offline.count === 2 && offline.unreadable.length === 0,
    { offlineBytes: offline.bytes, loadedBytes: added, fileBytes: offline.fileBytes });
  p.check('texture-remove-gives-the-bytes-and-the-gl-texture-back', tex.afterOne.exists === false && tex.loaded.report.bytes - tex.afterOne.report.bytes === 1024 * 256 * 4 && tex.loaded.wrappers - tex.afterOne.wrappers === 1
    && tex.afterAll.report.bytes === tex.before.report.bytes && tex.afterAll.wrappers === tex.before.wrappers,
    { afterOne: tex.afterOne.report.bytes, afterAll: tex.afterAll.report.bytes, baseline: tex.before.report.bytes, wrappers: [tex.before.wrappers, tex.loaded.wrappers, tex.afterOne.wrappers, tex.afterAll.wrappers] });
  p.check('texture-pixels-copied-once-outlive-the-texture', tex.kept.length === 1024 * 256 * 4 && p.near(tex.kept.first, [40, 200, 40, 255], 0) && p.near(tex.kept.last, [40, 200, 40, 255], 0), tex.kept);
  const verdict = checkTextureBudget(tex.loaded.report, 16 * MIB);
  p.check('texture-budget-check-fails-over-the-budget-and-names-the-largest', verdict.ok === false && /largest big 2048x2048/.test(verdict.message) && checkTextureBudget(tex.loaded.report, 32 * MIB).ok === true, verdict);

  // 5 to 8. View census and hiding by chunk. A 3000 x 3000 world of 900 props, added flat to the scene, seen through 400 x 300.
  const world = await p.page.evaluate(async () => {
    const next = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const node = game.renderer.renderNodes.getNode('TransformerImage');
    let calls = 0; const original = node.run; node.run = function () { calls++; return original.apply(this, arguments); };
    const transformed = async () => { await next(); calls = 0; await next(); return calls; };
    const base = await transformed();
    const props = [];
    for (let row = 0; row < 30; row++) for (let column = 0; column < 30; column++) props.push(scene.add.image(column * 100 + 50, row * 100 + 50, '__WHITE').setDisplaySize(16, 16).setDepth(row));
    const camera = scene.cameras.main;
    const expectedInView = props.filter((s) => s.x + 8 > 0 && s.x - 8 < 400 && s.y + 8 > 0 && s.y - 8 < 300).length;
    const flat = { transformed: (await transformed()) - base, census: viewCensus(game) };
    const order = scene.children.list.slice();
    const chunks = createChunkVisibility({ chunkWidth: 100, margin: 1 });
    for (const prop of props) chunks.add(prop);
    const first = chunks.update(camera.worldView);
    const culled = { transformed: (await transformed()) - base, census: viewCensus(game), update: first, stats: chunks.stats() };
    let writes = 0; const counted = createChunkVisibility({ chunkWidth: 100, margin: 1, apply: (o, v) => { writes++; o.setVisible(v); } });
    for (const prop of props) counted.add(prop);
    counted.update(camera.worldView); writes = 0;
    camera.setScroll(30, 20); await next(); await next();
    const still = counted.update(camera.worldView); const writesInsideChunk = writes;
    camera.setScroll(1500, 1500); await next(); await next();
    const moved = { update: chunks.update(camera.worldView), transformed: (await transformed()) - base, census: viewCensus(game), stats: chunks.stats() };
    const sameOrder = scene.children.list.length === order.length && scene.children.list.every((o, i) => o === order[i]);
    node.run = original; props.forEach((s) => s.destroy()); camera.setScroll(0, 0);
    return { base, expectedInView, flat, culled, still, writesInsideChunk, moved, sameOrder };
  });
  const row = (census) => census.cameras[0];
  p.check('census-submitted-equals-what-the-image-transformer-runs-on', world.flat.transformed === 900 && row(world.flat.census).submitted === 900 && row(world.culled.census).submitted === world.culled.transformed && row(world.moved.census).submitted === world.moved.transformed,
    { flat: [world.flat.transformed, row(world.flat.census).submitted], culled: [world.culled.transformed, row(world.culled.census).submitted], moved: [world.moved.transformed, row(world.moved.census).submitted] });
  p.check('census-a-flat-world-submits-everything-and-most-of-it-is-far', row(world.flat.census).inView === world.expectedInView && row(world.flat.census).far > 800 && checkViewCensus(world.flat.census).ok === false,
    { ...row(world.flat.census), expectedInView: world.expectedInView, verdict: checkViewCensus(world.flat.census).message });
  p.check('chunk-visibility-brings-the-submitted-count-down-to-the-ring', world.culled.transformed === world.culled.stats.visibleObjects && world.culled.transformed < 60 && row(world.culled.census).far === 0
    && row(world.culled.census).inView === world.expectedInView && checkViewCensus(world.culled.census).ok === true,
    { transformed: world.culled.transformed, stats: world.culled.stats, census: row(world.culled.census), firstUpdate: world.culled.update });
  p.check('chunk-visibility-follows-the-camera-and-writes-nothing-inside-a-chunk', world.still.changed === false && world.writesInsideChunk === 0 && world.moved.update.changed === true
    && world.moved.transformed === world.moved.stats.visibleObjects && row(world.moved.census).far === 0 && row(world.moved.census).inView >= 12,
    { still: world.still, writesInsideChunk: world.writesInsideChunk, moved: world.moved.update, transformed: world.moved.transformed, census: row(world.moved.census) });
  p.check('chunk-visibility-leaves-the-display-list-order-alone', world.sameOrder === true, { sameOrder: world.sameOrder });
} finally {
  rmSync(folder, { recursive: true, force: true });
  await p.finish();
}
