// Shared harness for the phaser-rendering-*.mjs probes (render graph, filters, stencil, meshes and GPU layers, textures and shaders).
//
// Purpose: boot a real Phaser 4.2.1 WebGL game inside Chromium, expose small browser-side helpers as `window.H`, and print
// the evidence a probe collected. These are LOGIC probes: draw-call counts, state flags, API return values and pixels of flat
// colours. They work on a hardware or a software GL stack and make no GPU-correctness or performance claim; each run prints
// the WebGL renderer string so the reader can see which stack produced the numbers.
//
// Use: do not run this file; run a probe that imports it:
//   node phaser-rendering-render-graph.mjs /absolute/path/to/project-with-phaser-and-playwright
// The host project supplies `phaser` (4.2.1) and `@playwright/test`. Set CHROME_CHANNEL=chrome to use installed Chrome.
// Set PROBE_GL=hardware to ask for the platform GPU backend; the default is `--enable-unsafe-swiftshader`, which also works
// on machines without a GPU.
//
// Browser-side helpers, available in page.evaluate as `H`:
//   await H.boot(gameConfig, sceneObject)  -> { game, scene } once the scene's create() has run (also sets window.game)
//   await H.frames(n)                      -> resolves after n rendered frames
//   await H.pixel(x, y)                    -> [r, g, b, a] of the next rendered frame at game coordinates (top-left origin)
//   await H.region(x, y, w, h)             -> flat RGBA array of a rendered region (via renderer.snapshot, top-left origin)
//   await H.draws()                        -> { elements, instanced, indices[] } counted over one steady-state frame
//   await H.tree()                         -> the render-node tree of one frame (renderNodes.setDebug + debugToString)
//   H.solid(scene, key, size, css)         -> creates a flat-colour canvas texture
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gpuArgs } from '../verify-checks.mjs';   // one flag list for the hardware lane, shared with the verifiers

const PRELUDE = `
window.H = {
  async boot(config, scene) {
    const game = new Phaser.Game(Object.assign({ type: Phaser.WEBGL, width: 160, height: 120, audio: { noAudio: true },
      backgroundColor: '#000000', render: { antialias: false } }, config));
    window.game = game;
    const s = await new Promise(res => {
      game.scene.add('probe', Object.assign({}, scene, { create() { if (scene && scene.create) scene.create.call(this); res(this); } }), true);
    });
    return { game, scene: s };
  },
  frames(n = 1) {
    return new Promise(res => {
      let k = 0;
      const f = () => { if (++k >= n) res(); else game.events.once('postrender', f); };
      game.events.once('postrender', f);
    });
  },
  async pixel(x, y) {
    await H.frames(1);
    return new Promise(res => { game.renderer.snapshotPixel(x, y, c => res([c.r, c.g, c.b, c.a])); });
  },
  async region(x, y, w, h) {
    await H.frames(1);
    const image = await new Promise(res => game.renderer.snapshot(res));
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(x, y, w, h).data);
  },
  async draws() {
    const r = game.renderer, counts = { elements: 0, instanced: 0, indices: [] };
    const de = r.drawElements, di = r.drawInstancedArrays;
    r.drawElements = function (ctx, tex, prog, vao, count) { counts.elements++; counts.indices.push(count); return de.apply(this, arguments); };
    r.drawInstancedArrays = function () { counts.instanced++; return di.apply(this, arguments); };
    await H.frames(2);
    counts.elements = 0; counts.instanced = 0; counts.indices.length = 0;
    await H.frames(1);
    r.drawElements = de; r.drawInstancedArrays = di;
    return counts;
  },
  tree() {
    const nodes = game.renderer.renderNodes;
    nodes.setDebug(true);
    return H.frames(1).then(() => nodes.debugToString());
  },
  solid(scene, key, size, css) {
    const t = scene.textures.createCanvas(key, size, size), c = t.getContext();
    c.fillStyle = css; c.fillRect(0, 0, size, size); t.refresh();
    return t;
  }
};`;

/**
 * Run one probe. `body(page, ctx)` returns the evidence object (it also asserts). The harness prints
 * { probe, renderer, evidence, errors } as JSON and exits non-zero if the body throws.
 */
export async function runProbe(name, body, { width = 320, height = 240 } = {}) {
  const project = resolve(process.argv[2] ?? '.');
  const require = createRequire(resolve(project, 'package.json'));
  const { chromium } = require('@playwright/test');
  const hardware = process.env.PROBE_GL === 'hardware';
  const browser = await chromium.launch({
    channel: process.env.CHROME_CHANNEL || undefined,
    args: hardware ? gpuArgs() : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      // ReadPixels stall notes come from the snapshot helper and are not findings.
      if ((message.type() === 'error' || message.type() === 'warning') && !/GPU stall due to ReadPixels/.test(text)) errors.push(text);
    });
    await page.setContent('<style>body{margin:0}</style>');
    await page.addScriptTag({ path: require.resolve('phaser') });
    await page.addScriptTag({ content: PRELUDE });
    const evidence = await body(page);
    const renderer = await page.evaluate(() => {
      if (!window.game || !game.renderer || !game.renderer.gl) return 'no game';
      const gl = game.renderer.gl, info = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    });
    console.log(JSON.stringify({ probe: name, renderer, evidence, errors }, null, 2));
    return { evidence, errors };
  } finally {
    await browser.close();
  }
}
