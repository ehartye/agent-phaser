// Probe for the smoothPixelArt claims in skills/phaser-worlds/references/cameras.md and skills/phaser-rendering/references/pixel-art-filters.md (Phaser 4.2.1).
//
// Purpose: measure how crisp a fractionally scaled pixel-art texel is under `smoothPixelArt: true` against `pixelArt: true`, on the default
// WebGL 1 context, at camera zooms 3.5 and 4.5, with and without a small rotation, at device pixel ratios 1 and 1.5. For six texels of known
// colour it reports: the fraction of the expected texel area that is exactly the source colour (the interior), how many pixels are a blend of
// colours (the edge), and the widest run of blended pixels between two pixels of exact source colour along a row (the edge width between texels).
// Run:  node phaser-rendering-smooth-pixel-art.mjs /absolute/path/to/project-with-phaser-and-playwright   (PROBE_GL=hardware for the GPU backend)
// Expected: JSON evidence per lane, then {"passed":true}. A logic probe: it prints the renderer so the numbers can be read with their stack.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gpuArgs } from '../verify-checks.mjs';   // one flag list for the hardware lane, shared with the verifiers

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const { chromium } = require('@playwright/test');
const hardware = process.env.PROBE_GL === 'hardware';
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  timeout: 15000,
  args: hardware ? gpuArgs() : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const lanes = [];
try {
  for (const dpr of [1, 1.5]) {
    const context = await browser.newContext({ viewport: { width: 200, height: 200 }, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && !/GPU stall due to ReadPixels/.test(message.text())) errors.push(message.text()); });
      await page.setContent('<style>body{margin:0}</style>');
      await page.addScriptTag({ path: require.resolve('phaser') });
      const evidence = await page.evaluate(async ratio => {
        const COLOURS = ['255,0,0', '0,255,0', '0,0,255', '0,255,255', '255,0,255', '255,255,0'];
        const out = { dpr: devicePixelRatio, runs: [] };
        for (const mode of ['pixelArt', 'smoothPixelArt']) {
          let game, scene;
          try {
            await new Promise(ready => {
              game = new Phaser.Game({
                type: Phaser.WEBGL, [mode]: true, audio: { noAudio: true }, banner: false,
                width: Math.round(200 * ratio), height: Math.round(200 * ratio),
                scale: { mode: Phaser.Scale.NONE, zoom: 1 / ratio },
                scene: { create() {
                  scene = this;
                  const texture = this.textures.createCanvas('blocks', 3, 2), ctx = texture.getContext();
                  COLOURS.map(c => `rgb(${c})`).forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i % 3, Math.floor(i / 3), 1, 1); });
                  texture.refresh();
                  this.probeImage = this.add.image(100, 100, 'blocks').setScale(2);
                  this.cameras.main.startFollow({ x: 100.23, y: 100.42 }, true, 1, 1);
                  ready();
                } },
              });
            });
            if (mode === 'smoothPixelArt') out.configFlags = { pixelArt: game.config.pixelArt, antialias: game.config.antialias, roundPixels: game.config.roundPixels };
            if (!out.renderer) {
              const gl = game.renderer.gl, info = gl.getExtension('WEBGL_debug_renderer_info');
              out.renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
              out.contextVersion = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 2 : 1;
            }
            for (const zoom of [3.5, 4.5]) for (const rotation of [0, 0.05]) {
              scene.cameras.main.setZoom(zoom);
              scene.probeImage.setRotation(rotation);
              await new Promise(r => game.events.once(Phaser.Core.Events.POST_RENDER, r));
              const image = await new Promise(r => game.renderer.snapshot(r));
              const canvas = document.createElement('canvas');
              canvas.width = image.width; canvas.height = image.height;
              const c2 = canvas.getContext('2d'); c2.drawImage(image, 0, 0);
              const { data } = c2.getImageData(0, 0, canvas.width, canvas.height);
              const exact = Object.fromEntries(COLOURS.map(c => [c, 0]));
              let blended = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (!(data[i] || data[i + 1] || data[i + 2])) continue;          // background
                const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
                if (key in exact) exact[key]++; else blended++;
              }
              // Widest run of blended pixels bounded on both sides by a pixel of exact source colour along a row: the width of the edge between two texels.
              // (A run beside the black background is the outer edge, and a row lying on a horizontal edge has no exact pixel beside it, so neither counts.)
              let edgeWidth = 0;
              for (let y = 0; y < canvas.height; y++) {
                let run = 0, seenExact = false;
                for (let x = 0; x < canvas.width; x++) {
                  const i = (y * canvas.width + x) * 4, key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
                  const lit = data[i] || data[i + 1] || data[i + 2];
                  if (lit && key in exact) { if (seenExact && run > edgeWidth) edgeWidth = run; seenExact = true; run = 0; }
                  else if (lit) run++;
                  else { seenExact = false; run = 0; }
                }
              }
              const texelArea = (2 * zoom) ** 2;                                  // game pixels one 2x-scaled texel covers; the canvas is sized to device pixels, so also device pixels
              const exactTotal = Object.values(exact).reduce((a, b) => a + b, 0);
              out.runs.push({ mode, zoom, rotation, texelArea: +texelArea.toFixed(1), exactFraction: +(exactTotal / (6 * texelArea)).toFixed(3),
                blendedPixels: blended, edgeWidthPx: edgeWidth, texelsVisible: Object.values(exact).filter(n => n > 0).length });
            }
          } finally { game?.destroy(true); }
        }
        return out;
      }, dpr);
      lanes.push({ ...evidence, errors });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ probe: 'smooth-pixel-art', hardware, lanes }, null, 1));

for (const lane of lanes) {
  assert.equal(lane.contextVersion, 1, 'Phaser creates a WebGL 1 context by default');
  assert.deepEqual(lane.configFlags.pixelArt, false, 'smoothPixelArt turns pixelArt off');
  for (const run of lane.runs) assert.equal(run.texelsVisible, 6, `${run.mode} zoom ${run.zoom} rotation ${run.rotation}: every texel stays visible`);
}
// Nearest sampling copies exact colours and blends nothing; smoothing blends a one-pixel edge and leaves the rest of the texel exact.
for (const lane of lanes) {
  for (const run of lane.runs.filter(r => r.mode === 'pixelArt')) {
    assert.ok(run.exactFraction > 0.99 && run.exactFraction < 1.01, `pixelArt exact fraction ${run.exactFraction}`);
    assert.equal(run.blendedPixels, 0);
    assert.equal(run.edgeWidthPx, 0);
  }
  for (const run of lane.runs.filter(r => r.mode === 'smoothPixelArt')) {
    assert.ok(run.blendedPixels > 0, 'smoothPixelArt blends the edges');
    assert.ok(run.edgeWidthPx >= 1 && run.edgeWidthPx <= 1, `smoothPixelArt edge width ${run.edgeWidthPx} px`);
    assert.ok(run.exactFraction >= 0.7 && run.exactFraction <= 0.9, `smoothPixelArt interior fraction ${run.exactFraction} at zoom ${run.zoom}`);
  }
  const smooth = lane.runs.filter(r => r.mode === 'smoothPixelArt' && r.rotation === 0);
  assert.ok(smooth[1].exactFraction > smooth[0].exactFraction, 'a larger texel footprint leaves a larger exact interior');
}
// The canvas is sized to device pixels (scale.zoom 1 / ratio), so one game pixel is one device pixel and the ratio changes nothing.
assert.deepEqual(lanes[0].runs, lanes[1].runs, 'DPR 1 and 1.5 measure the same when the canvas is sized to device pixels');
console.log(JSON.stringify({ passed: true }));
