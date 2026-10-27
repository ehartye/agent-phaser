// Phaser 4.2.1 foundations probe: config and boot, scale, loader, events and data, game objects, v3 leftovers.
//
// Purpose: reproduce the claims labelled [tested] in skills/engine-phaser/references (config-and-boot, scale-and-responsive,
//   loading-assets, events-and-data, game-objects-and-containers, v3-to-v4-migration). Each check id is cited there.
// Run:     node engine-phaser-foundations.mjs /absolute/path/to/host-project [--only=<id prefix>]
//   The host project supplies `phaser` 4.2.1 and `@playwright/test` (with Chromium). Set CHROME_CHANNEL=chrome to use installed Chrome.
//   A software WebGL renderer is enough: every check is about logic, sizes, counts or one pixel of known colour, never GPU output.
// Output:  one line per check ("ok   <id>" or "FAIL <id>: <reason>"), then a total. Exit code 1 when any check fails, 2 on a
//   usage error (wrong Phaser version). Takes about 30 seconds. It starts a local server on a dynamic port and writes nothing.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {brotliCompressSync, gzipSync} from 'node:zlib';
import {dirname, join, resolve} from 'node:path';

const argv = process.argv.slice(2);
const project = resolve(argv.find(a => !a.startsWith('--')) ?? '.');
const only = (argv.find(a => a.startsWith('--only=')) ?? '').slice(7);
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
const phaserDir = dirname(require.resolve('phaser/package.json'));
const phaserPackage = JSON.parse(readFileSync(join(phaserDir, 'package.json'), 'utf8'));
if (phaserPackage.version !== '4.2.1') { console.error(`This probe is pinned to phaser 4.2.1; found ${phaserPackage.version}`); process.exit(2); }
const dist = file => readFileSync(join(phaserDir, 'dist', file));

// 1x1 transparent PNG for the loader checks.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pages = new Map();
const server = http.createServer((req, res) => {
  const {pathname} = new URL(req.url, 'http://x');
  if (pathname.startsWith('/phaser/')) {
    try { res.writeHead(200, {'content-type': 'text/javascript'}); res.end(dist(pathname.slice(8))); } catch { res.writeHead(404); res.end(); }
  } else if (pages.has(pathname)) { res.writeHead(200, {'content-type': 'text/html'}); res.end(pages.get(pathname)); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// A page that loads the UMD build; `script` runs after it. Parent #game fills the page unless `box` is given.
let pageCount = 0;
const html = ({head = '', body = '<div id="game"></div>', script = '', box = 'width:100%;height:100%'}) =>
  `<!doctype html><html><head><style>html,body{margin:0;height:100%}#game{${box}}</style>${head}</head><body>${body}` +
  `<script src="/phaser/phaser.js"></script><script>${script}</script></body></html>`;
async function open(source, {viewport = {width: 800, height: 600}, dpr = 1, ready = 'window.ready'} = {}) {
  const path = `/p${++pageCount}`;
  pages.set(path, source);
  const context = await browser.newContext({viewport, deviceScaleFactor: dpr});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + path);
  if (ready) await page.waitForFunction(ready);
  page.errors = errors;
  page.close = () => context.close();
  return page;
}
const results = [];
async function check(id, fn) {
  if (only && !id.startsWith(only)) return;
  try { await fn(); results.push(true); console.log(`ok   ${id}`); }
  catch (e) { results.push(false); console.log(`FAIL ${id}: ${String(e.message).split('\n').slice(0, 12).join(' | ').slice(0, 700)}`); }
}
const withPage = (source, options, fn) => async () => { const page = await open(source, options); try { await fn(page); } finally { await page.close(); } };
// Console capture shared by the pages that need it.
const CAPTURE = 'window.log=[];const _e=console.error,_w=console.warn;console.error=(...a)=>{log.push("E:"+a.join(" "));_e(...a)};console.warn=(...a)=>{log.push("W:"+a.join(" "));_w(...a)};';
const SCENE = (body = '') => `class S extends Phaser.Scene{constructor(){super("s")}create(){window.sc=this;${body}window.ready=true}}`;
const GAME = (extra = '', scene = 'S') => `window.game=new Phaser.Game(Object.assign({type:Phaser.WEBGL,parent:"game",audio:{noAudio:true},scene:[${scene}]},${extra}));`;

// ---------------------------------------------------------------- config and boot
await check('config-esm-has-no-global', async () => {
  const esm = html({script: '', head: '', body: '<script type="module">import P,{Scene,WEBGL,VERSION} from "/phaser/phaser.esm.js";window.r={global:typeof window.Phaser,def:typeof P,scene:typeof Scene,webgl:WEBGL,version:VERSION};window.ready=true</script>'}).replace('<script src="/phaser/phaser.js"></script>', '');
  const page = await open(esm); const r = await page.evaluate(() => window.r); await page.close();
  assert.deepEqual(r, {global: 'undefined', def: 'object', scene: 'function', webgl: 2, version: '4.2.1'});
  const umd = await open(html({script: 'window.r=typeof window.Phaser;window.ready=true'}));
  assert.equal(await umd.evaluate(() => window.r), 'object'); await umd.close();
});
await check('config-exports-map', async () => {
  assert.deepEqual(Object.keys(phaserPackage.exports), ['.', './package.json']);
  assert.equal(phaserPackage.exports['.'].import, './dist/phaser.esm.js');
  assert.equal(phaserPackage.exports['.'].require, './dist/phaser.js');
  assert.match(require.resolve('phaser').replaceAll('\\', '/'), /\/phaser\/dist\/phaser\.js$/);
  for (const deep of ['phaser/dist/phaser-arcade-physics.js', 'phaser/dist/phaser.min.js', 'phaser/src/phaser.js']) {
    assert.throws(() => require.resolve(deep), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'}, deep);
  }
});
await check('config-bundle-sizes', async () => {
  const esm = dist('phaser.esm.min.js'), arcade = dist('phaser-arcade-physics.min.js');
  const gz = gzipSync(esm, {level: 9}).length, br = brotliCompressSync(esm).length;
  console.log(`     info esm.min ${esm.length} B, gzip ${gz} B, brotli ${br} B; arcade-only min ${arcade.length} B (${Math.round(100 * (1 - arcade.length / esm.length))}% smaller)`);
  assert.ok(gz > 330000 && gz < 380000, `gzip ${gz}`);
  assert.ok(br > 265000 && br < 305000, `brotli ${br}`);
  assert.ok(arcade.length < esm.length && arcade.length > esm.length * 0.85);
});
await check('config-derived-flags', withPage(html({script: `
  const C = o => new Phaser.Core.Config(o);
  const pa = C({pixelArt: true}), sm = C({smoothPixelArt: true}), plain = C({}), nested = C({pixelArt: false, render: {pixelArt: true}}), scaled = C({width: 100, scale: {width: 200}});
  window.r = {pa: [pa.antialias, pa.antialiasGL, pa.roundPixels], sm: [sm.pixelArt, sm.antialias, sm.antialiasGL, sm.roundPixels], plain: [plain.antialias, plain.roundPixels, plain.stencil, plain.alphaStrategy, plain.stencilAlphaStrategy, plain.powerPreference, plain.transparent],
    nested: nested.pixelArt, scaled: scaled.width, defaults: [plain.width, plain.height, plain.loaderMaxRetries, plain.loaderTimeout, plain.loaderMaxParallelDownloads, plain.inputActivePointers, plain.batchSize, plain.maxLights, plain.mipmapRegeneration]};
  window.ready = true;`}), {}, async page => {
  const r = await page.evaluate(() => window.r);
  assert.deepEqual(r.pa, [false, false, true]);
  assert.deepEqual(r.sm, [false, true, true, false]);
  assert.deepEqual(r.plain, [true, false, true, 'keep', 'dither', 'default', false]);
  assert.equal(r.nested, true); assert.equal(r.scaled, 200);
  assert.deepEqual(r.defaults, [1024, 768, 2, 0, 32, 1, 16384, 10, false]);
}));
await check('config-context-is-webgl1-and-follows-config', async () => {
  const a = await open(html({script: SCENE() + GAME('{}')})), b = await open(html({script: SCENE() + GAME('{transparent:true,render:{stencil:false,antialiasGL:false}}')}));
  try {
    const read = p => p.evaluate(() => { const gl = game.renderer.gl; return {version: gl.getParameter(gl.VERSION), attrs: gl.getContextAttributes(), type: game.renderer.type}; });
    const [x, y] = [await read(a), await read(b)];
    assert.match(x.version, /^WebGL 1\./); assert.equal(x.type, 2);
    assert.deepEqual([x.attrs.alpha, x.attrs.antialias, x.attrs.stencil, x.attrs.depth], [false, true, true, true]);
    assert.deepEqual([y.attrs.alpha, y.attrs.antialias, y.attrs.stencil], [true, false, false]);
  } finally { await a.close(); await b.close(); }
});
await check('config-parent-is-an-id-not-a-selector', async () => {
  const where = async parent => { const p = await open(html({script: SCENE() + GAME(`{width:64,height:64,parent:${JSON.stringify(parent)}}`)})); const r = await p.evaluate(() => game.canvas.parentElement.tagName + '#' + game.canvas.parentElement.id); await p.close(); return r; };
  assert.equal(await where('game'), 'DIV#game');
  assert.equal(await where('#game'), 'BODY#');
  assert.equal(await where('no-such-id'), 'BODY#');
});
await check('config-boot-timing', async () => {
  const make = where => `window.${where}Game=new Phaser.Game({type:Phaser.WEBGL,width:50,height:50,audio:{noAudio:true},scene:{create(){window.${where}Done=true}}});window.${where}Canvas=!!${where}Game.canvas;`;
  const page = await open(`<!doctype html><html><head><script src="/phaser/phaser.js"></script><script>${make('head')}</script></head><body>
    <script>${make('inline')}</script><script type="module">${make('module')}</script></body></html>`, {ready: 'window.headDone && window.inlineDone && window.moduleDone'});
  try {
    // Only a game made after the DOM is parsed (a module or deferred script) has its canvas at once; a classic script in the head or body waits.
    assert.deepEqual(await page.evaluate(() => [window.headCanvas, window.inlineCanvas, window.moduleCanvas]), [false, false, true]);
  } finally { await page.close(); }
});
await check('config-destroy-needs-a-running-loop', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), live = () => !!game.canvas.parentNode, out = {};
    game.loop.sleep(); game.destroy(true); await wait(250);
    out.asleep = {pending: game.pendingDestroy, inDom: live()};
    game.loop.wake(); await wait(250);
    out.awake = {pending: game.pendingDestroy, inDom: live()};
    return out;
  });
  assert.deepEqual(r, {asleep: {pending: true, inDom: true}, awake: {pending: false, inDom: false}});
}));
await check('config-fps-limit-throttles-steps', withPage(html({script: SCENE() + GAME('{width:50,height:50,fps:{limit:30}}')}), {}, async page => {
  const r = await page.evaluate(async () => {
    const count = ms => new Promise(res => { let n = 0; const f = () => n++; game.events.on('step', f); setTimeout(() => { game.events.off('step', f); res(n); }, ms); });
    const limited = await count(1500); game.loop.setFPSLimit(0); const free = await count(1500); game.loop.setFPSLimit(30);
    return {limited, free, rate: game.loop._limitRate, has: game.loop.hasFpsLimit};
  });
  assert.ok(r.limited / r.free > 0.35 && r.limited / r.free < 0.7, JSON.stringify(r));
  assert.deepEqual([r.has, Math.round(r.rate)], [true, 33]);
}));

// ---------------------------------------------------------------- scale
const SIZE = 'width:320,height:180';
const scaleReading = `window.read=()=>{const s=game.scale,c=game.canvas,r=c.getBoundingClientRect();return{attr:[c.width,c.height],css:[+r.width.toFixed(2),+r.height.toFixed(2)],game:[s.width,s.height],zoom:s.zoom}}`;
const scaleMode = (scale, options) => open(html({script: SCENE() + GAME(`{pixelArt:true,scale:{${SIZE},${scale}}}`) + scaleReading}), options);
await check('scale-modes-at-800x600', async () => {
  const read = async scale => { const p = await scaleMode(scale); const r = await p.evaluate(() => window.read()); await p.close(); return r; };
  const fit = await read('mode:Phaser.Scale.FIT');
  assert.deepEqual([fit.attr, fit.css], [[320, 180], [800, 450]]);                  // 2.5x: a fractional pixel scale
  const maxZoom = await read('mode:Phaser.Scale.FIT,zoom:Phaser.Scale.MAX_ZOOM');
  assert.deepEqual([maxZoom.zoom, maxZoom.css], [2, [800, 450]]);                    // zoom is reported but FIT ignores it
  const snap = await read('mode:Phaser.Scale.FIT,snap:{width:320,height:180}');
  assert.deepEqual(snap.css, [640, 360]);                                            // integer 2x
  const none = await read('mode:Phaser.Scale.NONE,zoom:2');
  assert.deepEqual(none.css, [640, 360]);
  const expand = await read('mode:Phaser.Scale.EXPAND');
  assert.deepEqual([expand.game, expand.css], [[320, 240], [800, 600]]);            // logical height follows the parent aspect
  const envelop = await read('mode:Phaser.Scale.ENVELOP');
  assert.ok(envelop.css[0] > 1066 && envelop.css[0] < 1067 && envelop.css[1] === 600, String(envelop.css));   // wider than the parent, centred by a negative margin
});
await check('scale-snap-collapses-below-one-x-unless-min-is-set', async () => {
  const read = async scale => { const p = await scaleMode(scale, {viewport: {width: 300, height: 200}}); const r = await p.evaluate(() => window.read()); await p.close(); return r.css; };
  assert.deepEqual(await read('mode:Phaser.Scale.FIT,snap:{width:320,height:180}'), [0, 0]);   // a parent smaller than the game floors to zero
  assert.deepEqual(await read('mode:Phaser.Scale.FIT,snap:{width:320,height:180},min:{width:320,height:180}'), [320, 180]);
});
await check('scale-resize-mode-ignores-device-pixel-ratio', withPage(html({script: SCENE() + GAME(`{scale:{mode:Phaser.Scale.RESIZE,width:"100%",height:"100%"}}`) + scaleReading}), {dpr: 2}, async page => {
  const r = await page.evaluate(() => ({dpr: devicePixelRatio, ...window.read()}));
  assert.deepEqual([r.dpr, r.attr, r.css], [2, [800, 600], [800, 600]]);            // backing store = CSS pixels, so the browser upscales 2x
}));
await check('scale-none-with-reciprocal-zoom-matches-device-pixels', async () => {
  for (const dpr of [1, 1.5, 2]) {
    const page = await open(html({script: SCENE() + GAME(`{pixelArt:true,scale:{mode:Phaser.Scale.NONE,width:Math.round(320*devicePixelRatio),height:Math.round(180*devicePixelRatio),zoom:1/devicePixelRatio}}`) + scaleReading}), {dpr});
    try {
      const r = await page.evaluate(() => window.read());
      assert.deepEqual([r.css, r.attr], [[320, 180], [Math.round(320 * dpr), Math.round(180 * dpr)]], `dpr ${dpr}`);
    } finally { await page.close(); }
  }
});
await check('scale-window-resize-is-immediate', withPage(html({script: SCENE() + GAME(`{scale:{mode:Phaser.Scale.FIT,${SIZE},resizeInterval:1000000}}`) + 'window.ev=0;game.scale.on("resize",()=>window.ev++);'}), {}, async page => {
  await page.evaluate(() => { window.ev = 0; });
  await page.setViewportSize({width: 640, height: 480});
  await page.waitForFunction('window.ev>0', null, {timeout: 400});                    // far sooner than the poll could explain
}));
await check('scale-parent-css-change-needs-bounds-then-refresh', withPage(html({script: SCENE() + GAME(`{scale:{mode:Phaser.Scale.FIT,${SIZE},resizeInterval:1000000}}`) + 'window.ev=[];game.scale.on("resize",(g,b,d)=>ev.push(Math.round(d.width)));', box: 'width:400px;height:300px'}), {}, async page => {
  const r = await page.evaluate(async () => {
    const s = game.scale, out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
    const reset = () => { ev.length = 0; };
    reset();                                                                          // drop the refresh that the boot itself emits
    document.getElementById('game').style.width = '600px'; await wait(300); out.noPoll = ev.slice(); reset();
    s.refresh(); out.refreshOnly = ev.slice(); reset();                                // stale: reads the old parent size
    s.getParentBounds(); s.refresh(); out.boundsThenRefresh = ev.slice();
    return out;
  });
  assert.deepEqual(r, {noPoll: [], refreshOnly: [400], boundsThenRefresh: [533]});
}));
await check('scale-default-poll-catches-parent-change', withPage(html({script: SCENE() + GAME(`{scale:{mode:Phaser.Scale.FIT,${SIZE}}}`) + 'window.ev=[];game.scale.on("resize",(g,b,d)=>ev.push(Math.round(d.width)));', box: 'width:400px;height:300px'}), {}, async page => {
  assert.equal(await page.evaluate(() => game.scale.resizeInterval), 500);
  await page.evaluate(() => { ev.length = 0; document.getElementById('game').style.width = '600px'; });
  await page.waitForFunction('ev.length>0', null, {timeout: 2000});
  assert.equal(await page.evaluate(() => ev[0]), 533);
}));
await check('scale-only-matching-cameras-follow-a-resize', withPage(html({script: SCENE('this.ui=this.cameras.add(0,0,100,50);') + GAME(`{scale:{mode:Phaser.Scale.RESIZE,width:"100%",height:"100%"}}`)}), {}, async page => {
  await page.setViewportSize({width: 500, height: 400});
  await page.waitForFunction('sc.cameras.main.width===500');
  assert.deepEqual(await page.evaluate(() => [sc.cameras.main.height, sc.ui.width, sc.ui.height]), [400, 100, 50]);
}));
await check('scale-lock-orientation-is-legacy-only', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => ({legacy: typeof screen.lockOrientation, modern: typeof screen.orientation?.lock, ret: game.scale.lockOrientation('landscape')}));
  assert.deepEqual(r, {legacy: 'undefined', modern: 'function', ret: false});
}));

// ---------------------------------------------------------------- loader
async function routed(source, handler, ready = 'window.ready') {
  const path = `/p${++pageCount}`; pages.set(path, source);
  const context = await browser.newContext({viewport: {width: 400, height: 300}}), page = await context.newPage();
  page.setDefaultTimeout(15000); const hits = {};
  await page.route('**/img/**', route => { const name = new URL(route.request().url()).pathname.slice(5); hits[name] = (hits[name] ?? 0) + 1; return handler(name, route); });
  await page.goto(origin + path); await page.waitForFunction(ready);
  page.hits = hits; page.close = () => context.close(); return page;
}
const ok = route => route.fulfill({status: 200, contentType: 'image/png', body: PNG});
await check('loader-http-errors-are-not-retried-network-errors-are', async () => {
  const page = await routed(html({script: CAPTURE + `class S extends Phaser.Scene{constructor(){super("s")}preload(){
      this.load.image("ok","/img/ok.png");this.load.image("gone","/img/gone.png");this.load.image("boom","/img/boom.png");
      this.load.on("loaderror",f=>log.push("loaderror:"+f.key));this.load.on("complete",(l,done,failed)=>log.push("complete:"+done+":"+failed))}
      create(){window.sc=this;window.ready=true}}` + GAME()}),
    (name, route) => name === 'gone.png' ? route.fulfill({status: 404, body: 'no'}) : name === 'boom.png' ? route.abort('failed') : ok(route));
  try {
    assert.deepEqual(page.hits, {'ok.png': 1, 'gone.png': 1, 'boom.png': 3});       // 404 once; a network failure once plus maxRetries (2)
    const r = await page.evaluate(() => ({log, has: ['ok', 'gone', 'boom'].map(k => sc.textures.exists(k))}));
    assert.deepEqual(r.log.filter(l => l.startsWith('complete')), ['complete:1:2']);
    assert.deepEqual(r.has, [true, false, false]);
  } finally { await page.close(); }
});
await check('loader-decode-failure-is-not-counted-in-total-failed', async () => {
  const page = await routed(html({script: CAPTURE + `class S extends Phaser.Scene{constructor(){super("s")}preload(){
      this.load.image("ok","/img/ok.png");this.load.image("gone","/img/gone.png");this.load.image("junk","/img/junk.png");
      this.load.on("loaderror",f=>log.push("loaderror:"+f.key));this.load.on("complete",(l,done,failed)=>log.push("complete:"+done+":"+failed))}
      create(){window.sc=this;window.ready=true}}` + GAME()}),
    (name, route) => name === 'gone.png' ? route.fulfill({status: 404, body: 'no'}) : name === 'junk.png' ? route.fulfill({status: 200, contentType: 'image/png', body: 'not an image'}) : ok(route));
  try {
    const r = await page.evaluate(() => ({log, totalFailed: sc.load.totalFailed, has: ['ok', 'gone', 'junk'].map(k => sc.textures.exists(k))}));
    assert.deepEqual(r.log.filter(l => l.startsWith('loaderror')), ['loaderror:gone']);          // the 404 raises loaderror; the undecodable 200 does not
    assert.equal(r.totalFailed, 1);                                                               // only the 404 is counted
    assert.equal(r.log.filter(l => l.includes('Failed to process file')).length, 1);              // the decode failure is one console line
    assert.deepEqual(r.has, [true, false, false]);                                                // the cache check is what sees it
  } finally { await page.close(); }
});
await check('loader-global-timeout-is-overridden-by-the-file-default', async () => {
  const hang = () => new Promise(() => {});                                                       // never answers: the request stays open
  const script = adapter => `window.errs=[];window.seen=[];const _s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(...a){seen.push(this.timeout);return _s.apply(this,a)};
    class S extends Phaser.Scene{constructor(){super("s")}preload(){window.started=true;window.fails=[];
      ${adapter ? 'this.load.on("addfile",(k,t,l,file)=>{if(!file.xhrSettings.timeout)file.xhrSettings.timeout=this.load.xhr.timeout});' : ''}
      this.load.maxRetries=0;this.load.image("hang","/img/hang.png");this.load.image("explicit","/img/explicit.png",{timeout:300});
      this.load.on("loaderror",f=>fails.push(f.key));this.load.on("complete",()=>{window.done=true})}create(){window.ready=true}}` + GAME('{loader:{timeout:200}}');
  const plain = await routed(html({script: script(false)}), hang, 'window.started');
  try {
    assert.equal(await plain.evaluate(() => game.config.loaderTimeout), 200);                    // the global timeout is configured...
    const seen = await plain.evaluate(() => new Promise(r => setTimeout(() => r(window.seen.slice()), 600)));
    assert.deepEqual(seen.slice().sort(), [0, 300]);                                              // ...but the file default 0 replaced it on the file that set nothing
    assert.equal(await plain.evaluate(() => window.done === true), false);                        // so that request never ends the load
  } finally { await plain.close(); }
  const fixed = await routed(html({script: script(true)}), hang, 'window.started');
  try {
    await fixed.waitForFunction(() => window.done === true);                                       // finite failure for both files
    const r = await fixed.evaluate(() => ({seen: window.seen.slice().sort(), fails: window.fails.slice().sort()}));
    assert.deepEqual(r, {seen: [200, 300], fails: ['explicit', 'hang']});                         // the explicit 300 ms was kept; the default-zero file inherited 200
  } finally { await fixed.close(); }
});
await check('loader-malformed-json-throws-after-failed-processing', async () => {
  const page = await routed(html({script: CAPTURE + `window.errs=[];window.addEventListener("error",e=>errs.push(e.message));
      class S extends Phaser.Scene{constructor(){super("s")}preload(){window.started=true;this.load.atlas("a","/img/atlas.png","/img/bad.json")}create(){window.sc=this;window.ready=true}}` + GAME()}),
    (name, route) => name === 'bad.json' ? route.fulfill({status: 200, contentType: 'application/json', body: '{bad'}) : ok(route), 'window.started');
  try {
    await page.waitForFunction(() => window.errs.length > 0);                                      // an uncaught exception from the loader's XHR callback
    const r = await page.evaluate(() => ({err: window.errs[0], processed: log.some(l => l.includes('Failed to process file')), has: [sc?.textures.exists('a') ?? false, game.cache.json.exists('a')]}));
    assert.match(r.err, /SyntaxError/);
    assert.equal(r.processed, true);
    assert.deepEqual(r.has, [false, false]);                                                      // the key is absent, so a cache check reports it
  } finally { await page.close(); }
});
await check('loader-duplicate-key-is-silent-and-completes-at-once', async () => {
  const page = await routed(html({script: CAPTURE + `class S extends Phaser.Scene{constructor(){super("s")}preload(){this.load.image("ok","/img/ok.png")}create(){window.sc=this;window.ready=true}}` + GAME()}), (n, route) => ok(route));
  try {
    const r = await page.evaluate(() => { log.length = 0; let args = null; sc.load.image('ok', '/img/ok.png'); sc.load.once('complete', (l, d, f) => { args = [d, f]; }); sc.load.start(); return {args, log: log.slice(), listed: sc.load.list.size}; });
    assert.deepEqual(r, {args: [0, 0], log: [], listed: 0});
  } finally { await page.close(); }
});
await check('loader-stopping-mid-load-registers-the-key-twice', async () => {
  const page = await routed(html({script: CAPTURE + `class S extends Phaser.Scene{constructor(){super("s")}preload(){window.loads=(window.loads||0)+1;this.load.image("slow","/img/slow.png")}create(){window.sc=this;window.ready=true}}` + GAME()}),
    async (n, route) => { await new Promise(r => setTimeout(r, 400)); return ok(route); }, 'window.loads===1');
  try {
    await page.evaluate(() => { game.scene.stop('s'); game.scene.start('s'); });         // the first request is still in flight
    await page.waitForFunction(() => window.loads === 2);
    await page.waitForFunction(() => log.some(l => l.includes('Texture key already in use: slow')), null, {timeout: 5000});
    assert.equal(await page.evaluate(() => game.textures.exists('slow')), true);
  } finally { await page.close(); }
});
await check('loader-listeners-end-with-the-scene', withPage(html({script: SCENE('this.load.on("complete",()=>{});this.time.addEvent({delay:20,loop:true,callback:()=>{window.ticks=(window.ticks||0)+1}});') + GAME()}), {}, async page => {
  await page.waitForFunction('window.ticks>1');
  await page.evaluate(() => { window.loader = sc.load; game.scene.stop('s'); });
  await page.waitForFunction(() => sc.sys.settings.status === Phaser.Scenes.SHUTDOWN);
  const before = await page.evaluate(async () => { const t = window.ticks; await new Promise(r => setTimeout(r, 200)); return {delta: window.ticks - t, listeners: window.loader.listenerCount('complete')}; });
  assert.deepEqual(before, {delta: 0, listeners: 0});                                // load listeners removed, scene timers destroyed
}));
await check('loader-pack-progress-falls-back-and-remove-pack-frees-textures', async () => {
  const pack = {section: {path: '/img/', files: ['a', 'b', 'c'].map(key => ({type: 'image', key, url: key + '.png'}))}};
  const page = await routed(html({script: `window.prog=[];class S extends Phaser.Scene{constructor(){super("s")}preload(){this.load.pack("pack","/img/pack.json");this.load.on("progress",v=>prog.push(+v.toFixed(2)))}create(){window.sc=this;window.ready=true}}` + GAME()}),
    (name, route) => name === 'pack.json' ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(pack)}) : ok(route));
  try {
    const r = await page.evaluate(() => { const prog = window.prog.slice(), wrappers = game.renderer.glTextureWrappers.length, keys = game.textures.getTextureKeys().length;
      sc.load.removePack('pack'); return {prog, keys, keysAfter: game.textures.getTextureKeys().length, freed: wrappers - game.renderer.glTextureWrappers.length, packStillCached: game.cache.json.exists('pack')}; });
    assert.ok(r.prog.some((v, i) => i && v < r.prog[i - 1]), r.prog.join());         // the bar reaches 1 after the pack file, then falls when its files are queued
    assert.deepEqual([r.keys, r.keysAfter, r.freed, r.packStillCached], [3, 0, 3, true]);
  } finally { await page.close(); }
});
await check('loader-aseprite-frames-must-be-numeric-keys', async () => {
  const frame = x => ({frame: {x, y: 0, w: 4, h: 4}, rotated: false, trimmed: false, spriteSourceSize: {x: 0, y: 0, w: 4, h: 4}, sourceSize: {w: 4, h: 4}, duration: 100});
  const meta = {app: 'x', image: 'a.png', size: {w: 8, h: 4}, scale: '1', frameTags: [{name: 'walk', from: 0, to: 1, direction: 'forward'}]};
  const data = {numeric: {frames: {0: frame(0), 1: frame(4)}, meta}, named: {frames: {'walk 0.aseprite': frame(0), 'walk 1.aseprite': frame(4)}, meta}};
  const page = await open(html({script: CAPTURE + `const cv=document.createElement("canvas");cv.width=8;cv.height=4;const png=cv.toDataURL("image/png");const data=${JSON.stringify(data)};
    class S extends Phaser.Scene{constructor(){super("s")}preload(){this.load.aseprite("numeric",png,data.numeric);this.load.aseprite("named",png,data.named)}
    create(){window.sc=this;window.ready=true}}` + GAME()}));
  try {
    const r = await page.evaluate(() => {
      const out = {}; for (const key of ['numeric', 'named']) { const made = sc.anims.createFromAseprite(key); out[key] = made.map(a => a.frames.length); sc.anims.remove('walk'); }
      log.length = 0; sc.anims.createFromAseprite('numeric'); sc.anims.createFromAseprite('numeric');
      return {...out, twice: log.slice(), cached: sc.cache.json.exists('numeric')};
    });
    assert.deepEqual(r, {numeric: [2], named: [0], twice: ['W:AnimationManager key already exists: walk'], cached: true});
  } finally { await page.close(); }
});

// ---------------------------------------------------------------- events and data
const RESTARTABLE = `class S extends Phaser.Scene{constructor(){super("s")}init(d){(window.inits=window.inits||[]).push(JSON.stringify(d))}
  create(){window.sc=this;window.created=(window.created||0)+1;if(window.leak)this.events.on("custom",()=>{});if(window.leak)this.registry.events.on("changedata-x",()=>{});
  if(!this.data.has("n"))this.data.set("n",0);this.data.inc("n");window.ready=true}}`;
const restart = async (page, fn) => { const n = await page.evaluate(() => window.created); await page.evaluate(fn); await page.waitForFunction(c => window.created === c + 1, n); };
await check('events-start-without-data-keeps-the-previous-data', withPage(html({script: RESTARTABLE + GAME()}), {}, async page => {
  await restart(page, () => sc.scene.start('s', {level: 5}));
  await restart(page, () => sc.scene.start('s'));
  await restart(page, () => sc.scene.restart());
  await restart(page, () => sc.scene.restart({}));
  assert.deepEqual(await page.evaluate(() => window.inits), ['{}', '{"level":5}', '{"level":5}', '{"level":5}', '{}']);
}));
await check('events-restart-keeps-scene-emitter-registry-and-scene-data', withPage(html({script: 'window.leak=true;' + RESTARTABLE + GAME()}), {}, async page => {
  for (let i = 0; i < 4; i++) await restart(page, () => sc.scene.restart({}));
  const r = await page.evaluate(() => ({custom: sc.events.listenerCount('custom'), registry: game.registry.events.listenerCount('changedata-x'), n: sc.data.get('n')}));
  assert.deepEqual(r, {custom: 5, registry: 5, n: 5});                                // one more of each per create(); scene.data is never cleared
}));
await check('events-census-catches-a-leak-and-passes-a-clean-scene', async () => {
  const census = `window.census=()=>{const out={};const add=(name,e)=>{for(const k of e.eventNames())out[name+":"+String(k)]=e.listenerCount(k)};
    add("game",game.events);add("scale",game.scale);add("registry",game.registry.events);add("scene",sc.events);add("textures",game.textures);add("anims",game.anims);return JSON.stringify(out)};`;
  const run = async leak => {
    const page = await open(html({script: `window.leak=${leak};` + RESTARTABLE + GAME() + census}));
    try {
      await restart(page, () => sc.scene.restart({}));
      const first = await page.evaluate(() => census());
      for (let i = 0; i < 9; i++) await restart(page, () => sc.scene.restart({}));
      return [first, await page.evaluate(() => census())];
    } finally { await page.close(); }
  };
  const [cleanA, cleanB] = await run(false), [leakA, leakB] = await run(true);
  assert.equal(cleanA, cleanB); assert.notEqual(leakA, leakB);
});
await check('events-data-manager-emits-for-unchanged-values', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => { let n = 0; game.registry.events.on('changedata-y', () => n++); for (let i = 0; i < 4; i++) game.registry.set('y', 1); return n; });
  assert.equal(r, 3);                                                                 // the first set creates the key; the other three each emit
}));
await check('events-off-without-a-function-removes-every-listener', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => { const hud = [], other = []; game.registry.events.on('changedata-score', () => hud.push(1)); game.registry.events.on('changedata-score', () => other.push(1)); game.registry.events.off('changedata-score'); game.registry.set('score', 1); game.registry.set('score', 2); return [hud.length, other.length]; });
  assert.deepEqual(r, [0, 0]);
}));
await check('events-destroy-reports-from-scene', withPage(html({script: RESTARTABLE.replace('window.ready=true', 'window.seen=window.seen||[];this.add.rectangle(0,0,4,4).on("destroy",(o,fromScene)=>window.seen.push(fromScene));window.ready=true') + GAME()}), {}, async page => {
  const explicit = await page.evaluate(() => { const seen = []; const a = sc.add.rectangle(0, 0, 4, 4); a.on('destroy', (o, fromScene) => seen.push(fromScene)); a.on('custom', () => {}); const had = a.listenerCount('custom'); a.destroy(); return {seen, had, left: a.listenerCount('custom')}; });
  assert.deepEqual(explicit, {seen: [false], had: 1, left: 0});                       // destroy() removes the listeners you attached to the object
  await restart(page, () => sc.scene.restart({}));
  assert.equal(await page.evaluate(() => window.seen[0]), true);                      // the scene's own teardown passes fromScene = true
}));

// ---------------------------------------------------------------- game objects
await check('objects-layer-is-a-mixin-without-a-transform', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => { const l = sc.add.layer(); let thrown = ''; try { sc.add.container(0, 0).add(l); } catch (e) { thrown = e.message; }
    return {type: l.type, instance: l instanceof Phaser.GameObjects.GameObject, filters: typeof l.enableFilters, move: typeof l.setPosition, scale: typeof l.setScale, list: Array.isArray(l.list), thrown}; });
  assert.deepEqual(r, {type: 'Layer', instance: false, filters: 'function', move: 'undefined', scale: 'undefined', list: true, thrown: 'Tried to add a Layer to a Container: this is not allowed'});
}));
await check('objects-container-hit-area-is-centred', withPage(html({script: SCENE('const c=this.add.container(100,100);c.setSize(50,50).setInteractive();window.c=c;') + GAME('{width:400,height:300}')}), {}, async page => {
  await page.waitForFunction('sc.input._list.includes(c)');                           // interactive objects join the input list on the next PRE_UPDATE
  const r = await page.evaluate(() => { const hit = (x, y) => { const p = sc.input.activePointer; p.x = p.worldX = x; p.y = p.worldY = y; return sc.input.hitTestPointer(p).includes(c); };
    return {origin: [c.originX, c.originY], centre: hit(100, 100), insideTopLeft: hit(78, 78), insideBottomRight: hit(122, 122), pastBottomRight: hit(130, 130), pastTopLeft: hit(70, 70)}; });
  assert.deepEqual(r, {origin: [0.5, 0.5], centre: true, insideTopLeft: true, insideBottomRight: true, pastBottomRight: false, pastTopLeft: false});
}));
await check('objects-hidden-or-transparent-gets-no-input', withPage(html({script: SCENE() + GAME('{width:200,height:200}')}), {}, async page => {
  const r = await page.evaluate(() => { const mk = f => { const o = sc.add.rectangle(50, 50, 20, 20, 0xff0000).setInteractive(); f?.(o); return sc.input.manager.inputCandidate(o, sc.cameras.main); };
    return {plain: mk(), alpha0: mk(o => o.setAlpha(0)), invisible: mk(o => o.setVisible(false)), scale0: mk(o => o.setScale(0)), zone: sc.input.manager.inputCandidate(sc.add.zone(50, 50, 20, 20).setInteractive(), sc.cameras.main)}; });
  assert.deepEqual(r, {plain: true, alpha0: false, invisible: false, scale0: false, zone: true});
}));
await check('objects-draw-order-scene-container-layer', withPage(html({script: SCENE(`
  const pair = x => { const red = this.add.rectangle(x, 30, 40, 40, 0xff0000).setDepth(5), blue = this.add.rectangle(x + 10, 40, 40, 40, 0x0000ff).setDepth(1); return [red, blue]; };
  pair(30); this.add.container(0, 0, pair(130)); this.add.layer().add(pair(230));`) + GAME('{width:300,height:100,backgroundColor:"#000000"}')}), {}, async page => {
  await page.waitForFunction('game.loop.frame>5');
  const r = await page.evaluate(async () => { const px = x => new Promise(res => { game.renderer.snapshotPixel(x, 40, c => res([c.red, c.green, c.blue].join())); }); const out = {};
    for (const [name, x] of [['scene', 40], ['container', 140], ['layer', 240]]) { const p = px(x); await new Promise(r => game.events.once('postrender', r)); out[name] = await p; } return out; });
  assert.deepEqual(r, {scene: '255,0,0', container: '0,0,255', layer: '255,0,0'});   // red has depth 5, blue 1; only the container ignores depth
}));
await check('objects-group-destroy-keeps-children-by-default', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => { const a = sc.add.group(), b = sc.add.group(), ka = sc.add.rectangle(0, 0, 4, 4), kb = sc.add.rectangle(0, 0, 4, 4), c = sc.add.container(0, 0), kc = sc.add.rectangle(0, 0, 4, 4);
    a.add(ka); b.add(kb); c.add(kc); a.destroy(); b.destroy(true); c.destroy(); return {kept: ka.active, destroyedWithGroup: kb.active, destroyedWithContainer: kc.active}; });
  assert.deepEqual(r, {kept: true, destroyedWithGroup: false, destroyedWithContainer: false});
}));

await check('objects-group-get-reuses-without-reviving', withPage(html({script: SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => { const g = sc.add.group({classType: Phaser.GameObjects.Rectangle, maxSize: 2}); const a = g.get(1, 1), b = g.get(2, 2), full = g.get(3, 3);
    g.killAndHide(a); const again = g.get(9, 9); return {full, sameObject: again === a, x: again.x, active: again.active, visible: again.visible, handedOutAgain: g.get(0, 0) === a, size: g.getLength()}; });
  assert.deepEqual(r, {full: null, sameObject: true, x: 9, active: false, visible: false, handedOutAgain: true, size: 2});   // get() moves a dead member but does not revive it, so it is handed out again until you call setActive(true)
}));

// ---------------------------------------------------------------- v3 leftovers
await check('migration-v3-apis-are-gone-or-stubbed', withPage(html({script: CAPTURE + SCENE() + GAME('{width:50,height:50}')}), {}, async page => {
  const r = await page.evaluate(() => {
    const img = sc.add.image(0, 0, '__DEFAULT'), P = Phaser, out = {};
    out.absent = {point: P.Geom.Point, bitmapMask: P.Display.Masks.BitmapMask, mesh: P.GameObjects.Mesh, plane: P.GameObjects.Plane, create: P.Create, pi2: P.Math.PI2, structsSet: P.Structs.Set, device: P.Device,
      setPipeline: img.setPipeline, setPostPipeline: img.setPostPipeline, postFX: img.postFX, preFX: img.preFX, generate: sc.textures.generate, loadObj: sc.load.obj, addMesh: sc.add.mesh, impact: P.Physics.Impact};
    out.present = {tau: P.Math.TAU === Math.PI * 2, piOver2: P.Math.PI_OVER_2 === Math.PI / 2, setLighting: typeof img.setLighting, filters: typeof img.enableFilters, tintMode: typeof img.setTintMode, atlasPCT: typeof sc.load.atlasPCT};
    log.length = 0; const chained = img.setTintFill(0xff0000); out.tintFill = {returned: String(chained), log: log.slice()};
    log.length = 0; out.mask = {sameObject: img.setMask({}) === img, log: log.slice()};
    out.roundPixels = new P.Core.Config({}).roundPixels;
    return out;
  });
  for (const [name, value] of Object.entries(r.absent)) assert.equal(value, undefined, `${name} should be undefined`);
  assert.deepEqual(r.present, {tau: true, piOver2: true, setLighting: 'function', filters: 'function', tintMode: 'function', atlasPCT: 'function'});
  assert.equal(r.tintFill.returned, 'undefined'); assert.match(r.tintFill.log[0], /^E:`setTintFill\(color\)` is removed as of Phaser 4/);
  assert.equal(r.mask.sameObject, true); assert.match(r.mask.log[0], /^W:.*not supported in WebGL\. Create a Mask filter/);
  assert.equal(r.roundPixels, false);
}));

await browser.close();
server.close();
const failed = results.filter(r => !r).length;
console.log(`${results.length - failed} of ${results.length} checks passed${only ? ` (filter "${only}")` : ''}`);
process.exit(failed ? 1 : 0);
