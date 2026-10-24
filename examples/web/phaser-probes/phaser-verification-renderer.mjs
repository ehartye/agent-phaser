// Run: node phaser-verification-renderer.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: show which WebGL renderer each Playwright Chromium launch variant really gets, and what Phaser does when WebGL is
// missing, so a CI job and a local run can state their renderer instead of assuming it (phaser-verification/references/ci-for-phaser.md).
// Asserted on every machine: explicit software flags give a software renderer, --disable-gpu still gives (software) WebGL,
// --disable-webgl gives none, Phaser.AUTO then falls back to Canvas silently and Phaser.WEBGL fails with "Cannot create WebGL context".
// Printed, not asserted, because they depend on the machine: the default launch (the headless shell), channel 'chromium' (new
// headless, the full browser, skipped if it is not installed) and the platform GPU flags. Only "software" or "hardware" is printed.
// Needs: phaser 4.2.1 and @playwright/test in the host project. Expected output: one line per variant, then "all checks passed".
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
const phaserJs = readFileSync(require.resolve('phaser'));
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

let rendererType = 'Phaser.AUTO';
const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); return; }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta charset=utf-8><body><script src="/phaser.js"></script><script>
window.game = new Phaser.Game({type: ${rendererType}, width: 100, height: 100, banner: false, audio: {noAudio: true}, scene: {create() { window.ready = true; }}});</script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;
let failed = false;

async function classify(options) {
  const browser = await chromium.launch({timeout: 30000, ...options});
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    return await page.evaluate(re => {
      const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      if (!gl) return 'none';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return new RegExp(re, 'i').test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))) ? 'software' : 'hardware';
    }, SOFTWARE.source);
  } finally { await browser.close(); }
}

async function phaserWith(type, options) {
  rendererType = type;
  const browser = await chromium.launch(options);
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.ready === true || window.game === undefined, null, {timeout: 5000}).catch(() => {});
    return await page.evaluate(() => ({ready: window.ready === true, type: window.game && window.game.renderer ? window.game.renderer.type : null})).then(r => ({...r, errors}));
  } finally { await browser.close(); }
}

try {
  const observed = {};
  observed['default launch (headless shell)'] = await classify({});
  observed['channel chromium (new headless)'] = await classify({channel: 'chromium'}).catch(() => 'not installed');
  observed['platform GPU flags'] = await classify({channel: 'chromium', args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist']}).catch(() => 'not installed');
  for (const [name, kind] of Object.entries(observed)) console.log(`info ${name}: ${kind}`);

  assert.equal(await classify({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}), 'software');
  console.log('ok   --use-angle=swiftshader --enable-unsafe-swiftshader: software');
  assert.equal(await classify({args: ['--disable-gpu']}), 'software', '--disable-gpu does not remove WebGL; it moves it to software');
  console.log('ok   --disable-gpu: WebGL still available, on a software renderer');
  assert.equal(await classify({args: ['--disable-webgl']}), 'none');
  console.log('ok   --disable-webgl: no WebGL context');

  const auto = await phaserWith('Phaser.AUTO', {args: ['--disable-webgl']});
  assert.deepEqual([auto.ready, auto.type, auto.errors], [true, 1, []], 'AUTO falls back to the Canvas renderer without a word');
  const webgl = await phaserWith('Phaser.WEBGL', {args: ['--disable-webgl']});
  assert.equal(webgl.ready, false); assert.ok(webgl.errors.some(e => /Cannot create WebGL context/.test(e)));
  console.log(`ok   without WebGL: Phaser.AUTO ran on Canvas (renderer type ${auto.type}); Phaser.WEBGL failed with "${webgl.errors[0]}"`);
  console.log('all checks passed');
} catch (error) {
  failed = true;
  console.error('FAILED:', error.message);
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
