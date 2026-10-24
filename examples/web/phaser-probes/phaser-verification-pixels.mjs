// Run: node phaser-verification-pixels.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove the Phaser 4.2.1 pixel-reading semantics and debug-draw traps that
// phaser-verification/references/visual-and-pixel-assertions.md and debugging-a-phaser-game.md claim: what snapshotPixel and
// snapshotArea return and when, the one-request-per-frame rule, absolute-valued coordinates, premultiplied alpha on a transparent
// canvas, the blank canvas read after a frame is presented, the silent __MISSING texture, and the Arcade debug-draw traps.
// Needs: phaser 4.2.1 and @playwright/test in the host project and a Chromium with WebGL. Software WebGL is enough: every
// value below is a flat colour or a fixed blend. Set CHROME_CHANNEL=chrome to use an installed Chrome.
// Optional: COMPARE_RENDERERS=1 also reads the same flat fills, a 37% blend, a four-corner gradient and an additive blend under software
// WebGL and under the platform GPU (new headless Chromium with ANGLE flags) and requires identical values; it needs a GPU.
// Expected output: one "ok" line per check with the measured numbers, then "all checks passed"; exit code 1 on a failure.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
const phaserJs = readFileSync(require.resolve('phaser'));

const html = config => `<!doctype html><meta charset=utf-8><body style="margin:0"><script src="/phaser.js"></script><script>
window.game = new Phaser.Game(Object.assign({type: Phaser.WEBGL, banner: false, width: 200, height: 200, audio: {noAudio: true}}, ${config}));
</script>`;
let currentConfig = '{}';
const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); }
  else { res.setHeader('content-type', 'text/html'); res.end(html(currentConfig)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({channel: process.env.CHROME_CHANNEL || undefined});
let failed = false;
const ok = (name, detail) => console.log(`ok   ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);

// Four quadrants: red, green, blue, and white at 50% alpha.
const quadrants = `scene: class extends Phaser.Scene { create() {
  this.add.rectangle(0, 0, 100, 100, 0xff0000).setOrigin(0); this.add.rectangle(100, 0, 100, 100, 0x00ff00).setOrigin(0);
  this.add.rectangle(0, 100, 100, 100, 0x0000ff).setOrigin(0); this.add.rectangle(100, 100, 100, 100, 0xffffff, 0.5).setOrigin(0);
  this.add.image(150, 50, 'no-such-key'); window.ready = true; } }`;

async function open(config, scale = {}) {
  currentConfig = config;
  const context = await browser.newContext({viewport: {width: 400, height: 400}, deviceScaleFactor: scale.dpr ?? 1});
  const page = await context.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.goto(origin);
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(() => {
    window.px = (x, y) => new Promise(res => game.renderer.snapshotPixel(x, y, c => res([c.red, c.green, c.blue, c.alpha])));
    window.frame = () => { game.loop.sleep(); game.step(performance.now(), 16); };
  });
  return {page, problems};
}

try {
  {
    const {page, problems} = await open(`{${quadrants}}`);
    const r = await page.evaluate(async () => ({
      red: await px(10, 10), green: await px(150, 10), blue: await px(10, 150), halfWhiteOverBlack: await px(150, 150),
      outside: await px(500, 500),
    }));
    assert.deepEqual(r.red, [255, 0, 0, 255]); assert.deepEqual(r.green, [0, 255, 0, 255]); assert.deepEqual(r.blue, [0, 0, 255, 255]);
    assert.ok(r.halfWhiteOverBlack.every((v, i) => (i < 3 ? Math.abs(v - 127.5) <= 1 : v === 255)), 'alpha 0.5 white over opaque black');
    assert.deepEqual(r.outside, [0, 0, 0, 0], 'outside the buffer reads zeros, not an error');
    ok('snapshotPixel: top-left origin, opaque colours exact, blends within one unit, outside is zeros', r);

    const twice = await page.evaluate(() => {
      let first = 'never called', second = 'never called'; frame();
      game.renderer.snapshotPixel(10, 10, c => { first = [c.red, c.green, c.blue]; });
      game.renderer.snapshotPixel(150, 10, c => { second = [c.red, c.green, c.blue]; });
      frame(); return {first, second};
    });
    assert.equal(twice.first, 'never called'); assert.deepEqual(twice.second, [0, 255, 0]);
    ok('two snapshot requests in one frame: only the last callback fires', twice);

    const negative = await page.evaluate(() => {
      let got; game.renderer.snapshotPixel(-150, 10, c => { got = [c.red, c.green, c.blue]; }); frame(); return got;
    });
    assert.deepEqual(negative, [0, 255, 0]);
    ok('a negative x is taken as its absolute value: (-150, 10) read (150, 10)', negative);

    const canvasRead = await page.evaluate(async () => {
      const copy = () => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.drawImage(game.canvas, 0, 0); return [...x.getImageData(10, 10, 1, 1).data]; };
      frame(); const sameTask = copy();
      await new Promise(r => setTimeout(r, 100)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {sameTask, later: copy(), preserveDrawingBuffer: game.renderer.gl.getContextAttributes().preserveDrawingBuffer};
    });
    assert.deepEqual(canvasRead.sameTask, [255, 0, 0, 255]);
    assert.deepEqual(canvasRead.later.slice(0, 3), [0, 0, 0], 'the presented drawing buffer is cleared');
    ok('drawImage(game.canvas) works in the render task and reads black afterwards (preserveDrawingBuffer is false)', canvasRead);

    const rt = await page.evaluate(() => {
      const texture = game.scene.scenes[0].add.renderTexture(0, 0, 50, 50).setOrigin(0), out = {}; let got = 'not called';
      const read = () => { texture.snapshotPixel(10, 10, c => { got = [c.red, c.green, c.blue, c.alpha]; }); const v = got; got = 'not called'; return v; };
      texture.fill(0x00ff00); out.beforeRender = read(); texture.render(); out.afterRender = read(); texture.destroy(); return out;
    });
    assert.deepEqual(rt, {beforeRender: [0, 0, 0, 0], afterRender: [0, 255, 0, 255]});
    ok('RenderTexture.snapshotPixel answers at once, and only sees commands that render() has run', rt);

    const graph = await page.evaluate(() => {
      const scene = game.scene.scenes[0];
      scene.add.container(0, 0, [scene.add.text(5, 5, 'hi').setName('label')]).setName('holder').setDepth(9);
      const describe = (sc) => {
        const walk = (o) => ({type: o.type, name: o.name || undefined, depth: o.depth, texture: o.texture ? o.texture.key : undefined, children: o.list ? o.list.map(walk) : undefined});
        sc.children.depthSort();
        return {key: sc.sys.settings.key, status: sc.sys.settings.status, objects: sc.children.list.map(walk)};
      };
      const d = describe(scene);
      return {status: d.status, running: Phaser.Scenes.RUNNING, types: d.objects.map(o => o.type), last: d.objects[d.objects.length - 1], image: d.objects.find(o => o.type === 'Image'),
        rendererType: game.renderer.type, spector: game.renderer.spector};
    });
    assert.equal(graph.status, graph.running); assert.equal(graph.last.name, 'holder'); assert.equal(graph.last.children[0].name, 'label');
    assert.equal(graph.image.texture, '__MISSING'); assert.equal(graph.rendererType, 2, 'WebGL renderer'); assert.equal(graph.spector, null);
    ok('scene graph read: status, depth order, nested container, __MISSING texture; the bundle has no embedded Spector', graph);

    const missing = await page.evaluate(() => game.scene.scenes[0].children.list.filter(o => o.texture && o.texture.key === '__MISSING').length);
    assert.equal(missing, 1); assert.deepEqual(problems.filter(p => !/ReadPixels/.test(p)), [], 'a missing texture key logs nothing');
    ok('add.image with an unknown key uses __MISSING and logs nothing', {missing});
    await page.context().close();
  }

  {
    const {page} = await open(`{transparent: true, ${quadrants}}`);
    const r = await page.evaluate(async () => {
      const pixel = await px(150, 150);
      const img = await new Promise(res => game.renderer.snapshotArea(140, 140, 20, 20, res));
      const c = document.createElement('canvas'); c.width = 20; c.height = 20; const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0);
      return {pixel, area: [...x.getImageData(5, 5, 1, 1).data], premultipliedAlpha: game.config.premultipliedAlpha};
    });
    assert.ok(r.pixel[3] < 140 && r.pixel[0] < 140, 'snapshotPixel returns premultiplied colour (about 127,127,127,127)');
    assert.ok(r.area[0] > 250 && r.area[3] < 140, 'snapshotArea un-premultiplies (about 255,255,255,127)');
    ok('transparent canvas: snapshotPixel is premultiplied, snapshotArea is not', r);
    await page.context().close();
  }

  {
    const {page} = await open(`{scale: {mode: Phaser.Scale.NONE, zoom: 2}, ${quadrants}}`, {dpr: 2});
    const r = await page.evaluate(async () => ({canvas: [game.canvas.width, game.canvas.height], css: game.canvas.style.width, dpr: devicePixelRatio, green: await px(150, 10), blue: await px(10, 150)}));
    assert.deepEqual(r.green, [0, 255, 0, 255]); assert.deepEqual(r.blue, [0, 0, 255, 255]);
    ok('with zoom 2 and devicePixelRatio 2 the coordinates are still game pixels', r);
    await page.context().close();
  }

  {
    const config = `{physics: {default: 'arcade', arcade: {gravity: {y: 0}}}, backgroundColor: '#000000', scene: class extends Phaser.Scene { create() {
      this.box = this.add.rectangle(100, 100, 40, 40, 0x202020); this.physics.add.existing(this.box); window.ready = true; } }}`;
    const {page} = await open(config);
    const r = await page.evaluate(async () => {
      const world = game.scene.scenes[0].physics.world, out = {};
      world.drawDebug = true; game.loop.sleep();
      try { game.step(performance.now(), 16); out.flagOnly = 'no error'; } catch (e) { out.flagOnly = e.message; }
      world.createDebugGraphic(); frame(); out.outline = await (async () => { const p = px(80, 100); frame(); return p; })();
      world.drawDebug = false; frame(); out.afterFlagOff = await (async () => { const p = px(80, 100); frame(); return p; })();
      world.debugGraphic.clear(); frame(); out.afterClear = await (async () => { const p = px(80, 100); frame(); return p; })();
      return out;
    });
    assert.match(r.flagOnly, /reading 'clear'/);
    assert.ok(r.outline[0] > 100 && r.outline[2] > 100 && r.outline[1] < 40, 'the default body outline is magenta, anti-aliased on a pixel edge');
    assert.deepEqual(r.afterFlagOff, r.outline, 'switching drawDebug off leaves the last outline on screen');
    assert.deepEqual(r.afterClear.slice(0, 3), [32, 32, 32], 'clearing the graphic removes it');
    ok('Arcade debug draw: flag-only throws, outline is partial magenta, stays after the flag is off until cleared', r);
    await page.context().close();
  }

  if (process.env.COMPARE_RENDERERS) {
    const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
    const scene = `{scene: class extends Phaser.Scene { create() {
      this.add.rectangle(0, 0, 100, 100, 0x336699).setOrigin(0); this.add.rectangle(100, 0, 100, 100, 0xffffff, 0.37).setOrigin(0);
      const g = this.add.graphics(); g.fillGradientStyle(0xff0000, 0xff0000, 0x0000ff, 0x0000ff, 1); g.fillRect(0, 100, 100, 100);
      this.add.rectangle(100, 100, 100, 100, 0x123456, 0.5).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD); window.ready = true; } }}`;
    const readings = {};
    for (const [name, options] of [['software', {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}], ['gpu', {channel: 'chromium', args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist']}]]) {
      const other = await chromium.launch(options);
      currentConfig = scene;
      const page = await other.newPage(); await page.goto(origin); await page.waitForFunction(() => window.ready === true);
      readings[name] = await page.evaluate(async () => {
        const px = (x, y) => new Promise(res => game.renderer.snapshotPixel(x, y, c => res([c.red, c.green, c.blue, c.alpha])));
        const gl = game.renderer.gl, info = gl.getExtension('WEBGL_debug_renderer_info');
        return {software: /swiftshader|llvmpipe|software|basic render/i.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))),
          flat: await px(50, 50), blend37: await px(150, 50), gradientTop: await px(50, 101), gradientMiddle: await px(50, 150), additive: await px(190, 190)};
      });
      await other.close();
    }
    const {software: softwareFlag, ...soft} = readings.software, {software: gpuFlag, ...gpu} = readings.gpu;
    assert.equal(softwareFlag, true); assert.equal(gpuFlag, false, 'the second launch must be on a hardware renderer');
    assert.deepEqual(gpu, soft, 'flat fills, blends and gradients read the same on both renderers');
    ok('software WebGL and the platform GPU read identical values for simple 2D content', soft);
  }

  console.log('all checks passed');
} catch (error) {
  failed = true;
  console.error('FAILED:', error.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
