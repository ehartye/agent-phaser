// Shared helper for the phaser-worlds probes (phaser-worlds-cameras.mjs, -lights.mjs, -tilemaps.mjs, -particles.mjs).
// Not run on its own. Each probe starts its own tiny Phaser 4.2.1 scene in a throwaway page (no dev server, no game code),
// so the host project only has to provide `phaser` (4.2.1) and `playwright-core` or `@playwright/test`.
//   node examples/web/phaser-probes/phaser-worlds-cameras.mjs /absolute/path/to/host-project
// A software renderer is enough for these logic and pixel-value checks. They print the renderer string and make no
// frame-time claims about a particular GPU; the cost numbers they print are CPU-side only and are for comparison.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export async function startProbe(projectArg, { width = 400, height = 300, game: gameConfig = {}, setup = '' } = {}) {
  const project = resolve(projectArg ?? '.');
  const require = createRequire(resolve(project, 'package.json'));
  let pw;
  try { pw = require('@playwright/test'); } catch { pw = require('playwright-core'); }
  const args = ['--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'];
  if (process.env.ANGLE) args.push(`--use-angle=${process.env.ANGLE}`);
  const browser = await pw.chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined, args });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<style>body{margin:0;background:#000}</style>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  const renderer = await page.evaluate(async ({ width, height, gameConfig, setup }) => {
    await new Promise((ready) => {
      window.game = new Phaser.Game(Object.assign({
        type: Phaser.WEBGL, width, height, backgroundColor: '#000000', audio: { noAudio: true }, banner: false, pixelArt: true,
        scene: { create() { window.scene = this; new Function('scene', 'Phaser', setup)(this, Phaser); ready(); } },
      }, gameConfig));
    });
    const gl = game.renderer.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: Phaser.VERSION, renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
  }, { width, height, gameConfig, setup });
  if (renderer.version !== '4.2.1') throw new Error(`These probes document Phaser 4.2.1; got ${renderer.version}`);

  const results = [];
  const probe = {
    page, renderer, errors,
    // Wait for n rendered frames.
    frames: (n = 1) => page.evaluate(async (n) => {
      for (let i = 0; i < n; i++) await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    }, n),
    // Read one canvas pixel (top-left origin) as [r, g, b, a]. Call after `frames`.
    pixel: (x, y) => page.evaluate((p) => new Promise((r) => game.renderer.snapshotPixel(p[0], p[1], (c) => r([c.r, c.g, c.b, c.a]))), [x, y]),
    check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); if (!ok) process.exitCode = 1; },
    near: (a, b, tol = 3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol),
    async finish() {
      const failed = results.filter((r) => !r.ok);
      console.log(JSON.stringify({ renderer, checks: results.length, failed: failed.length, results, pageErrors: errors }, null, 2));
      await browser.close();
      if (errors.length) process.exitCode = 1;
    },
  };
  return probe;
}
