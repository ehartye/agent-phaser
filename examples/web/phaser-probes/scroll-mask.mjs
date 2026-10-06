// Run: node scroll-mask.mjs /absolute/path/to/project-with-phaser-and-playwright
// Requires Phaser 4.2.1 and Playwright's Chromium (or set CHROME_CHANNEL=chrome).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const errors = [];
  const warnings = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setContent('<style>body{margin:0}</style>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  const gpu = await page.evaluate(async () => {
    await new Promise(resolveReady => {
      window.probe = { mode: 'legacy', created: 0, clicks: 0 };
      window.game = new Phaser.Game({
        type: Phaser.WEBGL, width: 400, height: 300, backgroundColor: '#000000',
        audio: { noAudio: true }, render: { antialias: false, roundPixels: true },
        scene: {
          create() {
            const scene = this;
            const viewport = new Phaser.Geom.Rectangle(50, 50, 80, 60);
            const red = scene.add.rectangle(0, -30, 80, 200, 0xff0000).setOrigin(0);
            const green = scene.add.rectangle(0, 170, 80, 20000, 0x00ff00).setOrigin(0);
            const content = scene.add.container(0, 0, [red, green]);
            const panel = scene.add.container(viewport.x, viewport.y, [content]);
            const shape = scene.make.graphics({ x: 0, y: 0 });
            shape.fillStyle(0xffffff).fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
            let legacy, mask;
            if (probe.mode === 'legacy') {
              legacy = shape.createGeometryMask();
              panel.setMask(legacy);
            } else {
              panel.enableFilters();
              // Bound the filter surface to the rendering camera, not the 20,000px document.
              panel.filtersFocusContext = true;
              mask = panel.filters.external.addMask(shape, false, scene.cameras.main);
              mask.autoUpdate = false;
            }
            // Only the viewport owns input. Masked content has no independent hit targets.
            const zone = scene.add.zone(viewport.x, viewport.y, viewport.width, viewport.height)
              .setOrigin(0).setInteractive();
            zone.on('pointerup', () => { probe.clicks++; });
            scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
              legacy?.destroy();
              shape.destroy();
            });
            Object.assign(probe, { scene, panel, content, mask, created: probe.created + 1 });
            resolveReady();
          },
        },
      });
    });
    const gl = game.renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: Phaser.VERSION, renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
  });
  assert.equal(gpu.version, '4.2.1');
  assert.doesNotMatch(gpu.renderer, /swiftshader|llvmpipe|software/i, 'Hardware GPU required');
  async function pixels(points) {
    return page.evaluate(async samplePoints => {
      const output = [];
      // snapshotPixel schedules one capture; concurrent requests overwrite each other.
      for (const [x, y] of samplePoints) {
        output.push(await new Promise(resolvePixel => game.renderer.snapshotPixel(x, y, color => {
          resolvePixel([color.r, color.g, color.b]);
        })));
      }
      return output;
    }, points);
  }
  const points = [[60, 30], [60, 60], [60, 120]];
  const red = [255, 0, 0], black = [0, 0, 0], green = [0, 255, 0];
  const legacy = await pixels(points);
  assert.deepEqual(legacy, [red, red, red], 'Legacy mask must reproduce overflow');
  assert(warnings.some(value => value.includes('not supported in WebGL')));
  await page.evaluate(() => { probe.mode = 'native'; probe.scene.scene.restart(); });
  await page.waitForFunction(() => probe.created === 2);
  const native = await pixels(points);
  assert.deepEqual(native, [black, red, black]);
  await page.mouse.click(60, 30);
  await page.mouse.click(60, 60);
  await page.mouse.click(60, 120);
  assert.equal(await page.evaluate(() => probe.clicks), 1, 'Outside pixels must not activate content');
  await page.evaluate(() => { probe.content.y = -200; });
  assert.deepEqual(await pixels(points), [black, green, black], 'Clip stays fixed as content scrolls');
  assert.deepEqual(await page.evaluate(() => [probe.panel.filterCamera.width, probe.panel.filterCamera.height]), [400, 300]);
  // The view camera is explicit: verify integer zoom, not only the default transform.
  await page.evaluate(() => { probe.scene.cameras.main.setOrigin(0, 0).setZoom(2); probe.panel.filterCamera.setOrigin(0,0); probe.mask.needsUpdate = true; });
  assert.deepEqual(await pixels([[120, 60], [120, 120], [120, 240]]), [black, green, black]);
  await page.evaluate(() => { probe.scene.cameras.main.setZoom(1); probe.mask.needsUpdate = true; });
  const counts = () => page.evaluate(() => ({
    textures: game.textures.getTextureKeys().length,
    children: probe.scene.children.length,
    shutdownListeners: probe.scene.events.listenerCount(Phaser.Scenes.Events.SHUTDOWN),
  }));
  const baseline = await counts();
  for (let i = 0; i < 10; i++) {
    const next = await page.evaluate(() => { const next = probe.created + 1; probe.scene.scene.restart(); return next; });
    await page.waitForFunction(value => probe.created === value, next);
    assert.deepEqual(await pixels(points), [black, red, black]);
    assert.deepEqual(await counts(), baseline, 'Scene restart must not grow owned resources');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...gpu, legacy, native, scrolled: true, zoom2: true, outsideInputBlocked: true,
    restartCount: 10, baseline, errors }, null, 2));
} finally {
  await browser.close();
}
