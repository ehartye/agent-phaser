// Run: node source-pixels.mjs /absolute/path/to/project-with-phaser-and-playwright
// Requires Phaser 4.2.1 and hardware Chromium. Set CHROME_CHANNEL=chrome if needed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  timeout: 15000,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const results = [];
try {
  for (const dpr of [1, 1.5]) {
    const context = await browser.newContext({viewport: {width: 160, height: 160}, deviceScaleFactor: dpr});
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<style>body{margin:0}</style>');
      await page.addScriptTag({path: require.resolve('phaser')});
      const evidence = await page.evaluate(async ratio => {
        let game, scene;
        const bounded = (promise, label) => {
          let timer;
          return Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error(`${label} timed out`)), 5000);
          })]).finally(() => clearTimeout(timer));
        };
        try {
          await bounded(new Promise(resolveReady => {
            game = new Phaser.Game({
              type: Phaser.WEBGL, pixelArt: true, audio: {noAudio: true},
              width: Math.round(160 * ratio), height: Math.round(160 * ratio),
              scale: {mode: Phaser.Scale.NONE, zoom: 1 / ratio},
              scene: {create() {
                scene = this;
                const texture = this.textures.createCanvas('blocks', 3, 2), ctx = texture.getContext();
                ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00'].forEach((color, i) => {
                  ctx.fillStyle = color; ctx.fillRect(i % 3, Math.floor(i / 3), 1, 1);
                });
                texture.refresh();
                this.probeImage = this.add.image(49, 49, 'blocks').setOrigin(0).setScale(2);
                this.cameras.main.startFollow({x: 50.23, y: 50.42}, true, 1, 1);
                resolveReady();
              }},
            });
          }), 'Scene boot');
          const gl = game.renderer.gl, debug = gl.getExtension('WEBGL_debug_renderer_info');
          const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
          const samples = [];
          for (const [artScale, zoom] of [[2, 3], [2, 3.5], [2, 4], [2, 4.5], [2, 7.5], [1, 3.5], [1, 4]]) {
            scene.probeImage.setScale(artScale);
            scene.cameras.main.setZoom(zoom);
            await bounded(new Promise(resolveFrame => game.events.once(Phaser.Core.Events.POST_RENDER, resolveFrame)), 'Camera frame');
            const image = await bounded(new Promise(resolveSnapshot => game.renderer.snapshot(resolveSnapshot)), 'Framebuffer');
            if (!(image instanceof HTMLImageElement)) throw Error('Image snapshot unavailable');
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const blocks = ['255,0,0', '0,255,0', '0,0,255', '0,255,255', '255,0,255', '255,255,0'].map(color => {
              let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
              for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}` !== color) continue;
                left = Math.min(left, x); right = Math.max(right, x);
                top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
              }
              return {color, count, width: right - left + 1, height: bottom - top + 1};
            });
            samples.push({artScale, zoom, sourcePixels: artScale * zoom, renderRoundPixels: scene.cameras.main.renderRoundPixels, blocks});
          }
          const rect = game.canvas.getBoundingClientRect();
          return {version: Phaser.VERSION, renderer, dpr: devicePixelRatio, canvasWidth: game.canvas.width,
            cssWidth: rect.width, scaleZoom: game.scale.zoom, samples};
        } finally {
          game?.destroy(true);
        }
      }, dpr);
      // Keep measurements visible even if a subsequent assertion fails.
      console.log(JSON.stringify({...evidence, errors}, null, 2));
      assert.equal(evidence.version, '4.2.1');
      assert.doesNotMatch(evidence.renderer, /swiftshader|llvmpipe|software/i, 'Hardware GPU required');
      assert.equal(evidence.dpr, dpr);
      assert.equal(evidence.canvasWidth, Math.round(160 * dpr));
      assert.equal(evidence.cssWidth, 160);
      for (const sample of evidence.samples.filter(value => Number.isInteger(value.sourcePixels))) {
        for (const block of sample.blocks) {
          assert.equal(block.width, sample.sourcePixels);
          assert.equal(block.height, sample.sourcePixels);
          assert.equal(block.count, sample.sourcePixels ** 2);
        }
      }
      const fractionalUi = evidence.samples.find(value => value.artScale === 1 && value.zoom === 3.5);
      for (const block of fractionalUi.blocks) assert(block.count > 0, 'Every fractional UI texel must remain visible');
      assert(new Set(fractionalUi.blocks.map(block => block.width)).size > 1, 'Fractional UI source blocks must expose uneven widths');
      assert.deepEqual(errors, []);
      results.push({dpr, renderer: evidence.renderer, samples: evidence.samples.length});
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({passed: true, results}));
} finally {
  await browser.close();
}
