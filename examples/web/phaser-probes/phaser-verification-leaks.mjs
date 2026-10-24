// Run: node phaser-verification-leaks.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove the Phaser 4.2.1 lifecycle facts that phaser-verification/references/leaks-and-lifecycle-tests.md claims: which
// resources a scene restart cleans by itself and which it leaves to you, the counters that show each leak, the listener Phaser leaves on
// document after Game.destroy(), and what a lost and restored WebGL context does to a RenderTexture.
// Needs: phaser 4.2.1 and @playwright/test in the host project and a Chromium with WebGL (software WebGL is fine). Set
// CHROME_CHANNEL=chrome to use an installed Chrome.
// Expected output: one "ok" line per check with the measured counters, then "all checks passed"; exit code 1 on a failure.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
const phaserJs = readFileSync(require.resolve('phaser'));

const html = body => `<!doctype html><meta charset=utf-8><body><div id=host></div><script src="/phaser.js"></script><script>${body}</script>`;
let currentBody = '';
const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); }
  else { res.setHeader('content-type', 'text/html'); res.end(html(currentBody)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({channel: process.env.CHROME_CHANNEL || undefined});
let failed = false;
const ok = (name, detail) => console.log(`ok   ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);

// Installed before Phaser loads: a net count of addEventListener minus removeEventListener per target and type.
const ledgerScript = () => {
  const ledger = new Map(), add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const name = t => (t === window ? 'window' : t === document ? 'document' : t.nodeName || t.constructor.name);
  const capture = o => (typeof o === 'object' && o !== null ? !!o.capture : !!o);
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    const key = `${name(this)}|${type}`; if (!ledger.has(key)) ledger.set(key, []);
    if (!ledger.get(key).some(e => e[0] === this && e[1] === fn && e[2] === capture(options))) ledger.get(key).push([this, fn, capture(options)]);
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const list = ledger.get(`${name(this)}|${type}`), i = list ? list.findIndex(e => e[0] === this && e[1] === fn && e[2] === capture(options)) : -1;
    if (i >= 0) list.splice(i, 1);
    return remove.call(this, type, fn, options);
  };
  window.__ledger = () => Object.fromEntries([...ledger].filter(([, l]) => l.length).map(([k, l]) => [k, l.length]));
};

async function open(body) {
  currentBody = body;
  const page = await browser.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(ledgerScript);
  await page.goto(origin);
  return {page, problems};
}

// A scene that creates a lot per restart. window.mode picks what it adds that Phaser does not own.
const sceneBody = `
class Level extends Phaser.Scene {
  constructor() { super('Level'); }
  create() {
    window.creates = (window.creates || 0) + 1; const n = window.creates;
    this.add.rectangle(10, 10, 20, 20, 0xff0000); this.add.text(0, 0, 'x'); this.add.particles(0, 0, '__DEFAULT', {speed: 10, lifespan: 500});
    this.tweens.add({targets: this.add.rectangle(5, 5, 4, 4, 0xff), x: 100, duration: 1000, repeat: -1});
    this.time.addEvent({delay: 100, loop: true, callback: () => {}});
    this.input.on('pointerdown', () => {}); this.input.keyboard.addKey('SPACE'); this.input.keyboard.on('keydown-A', () => {});
    this.physics.add.existing(this.add.rectangle(30, 30, 10, 10, 0x00ff00));
    const mode = window.mode;
    if (mode === 'events' || mode === 'fixed') {                  // listeners on emitters that outlive the scene
      const onRender = () => {}, onResize = () => {}, onUpdate = () => {};
      game.events.on('postrender', onRender); this.scale.on('resize', onResize); this.events.on('update', onUpdate);
      this.registry.events.on('changedata', onRender);
      if (mode === 'fixed') this.events.once('shutdown', () => {
        game.events.off('postrender', onRender); this.scale.off('resize', onResize); this.events.off('update', onUpdate); this.registry.events.off('changedata', onRender);
      });
    }
    if (mode === 'textures') this.textures.addCanvas('c' + n, document.createElement('canvas'));   // a new key per restart
    window.ready = true;
  }
}
window.game = new Phaser.Game({type: Phaser.WEBGL, width: 200, height: 200, banner: false, audio: {noAudio: true}, parent: 'host',
  physics: {default: 'arcade'}, scene: Level});`;

const counters = () => {
  const scene = game.scene.getScenes(false)[0], names = e => Object.fromEntries(e.eventNames().map(n => [String(n), e.listenerCount(n)]));
  return {
    children: scene.children.length, tweens: scene.tweens.getTweens().length, timers: scene.time._active.length + scene.time._pendingInsertion.length,
    textureKeys: game.textures.getTextureKeys().length, glTextures: game.renderer.glTextureWrappers.length,
    gameEvents: names(game.events), sceneEvents: names(scene.events), scale: names(game.scale), registry: names(game.registry.events),
    scenes: game.scene.scenes.length,
  };
};
async function restartTimes(page, times) {
  for (let i = 0; i < times; i++) {
    const before = await page.evaluate(() => window.creates);
    await page.evaluate(() => game.scene.getScenes(false)[0].scene.restart());
    await page.waitForFunction(n => window.creates === n + 1, before);
  }
}
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

try {
  const results = {};
  for (const mode of ['clean', 'events', 'fixed', 'textures']) {
    const {page, problems} = await open(`window.mode = '${mode}'; ${sceneBody}`);
    await page.waitForFunction(() => window.ready === true);
    await page.evaluate(() => new Promise(res => game.events.once('postrender', res)));
    const base = await page.evaluate(counters);
    await restartTimes(page, 10);
    await page.evaluate(() => new Promise(res => game.events.once('postrender', res)));
    const after = await page.evaluate(counters);
    results[mode] = {base, after, problems};
    await page.close();
  }
  const grew = (mode, group, event) => results[mode].after[group][event] - results[mode].base[group][event];
  for (const key of ['children', 'tweens', 'timers', 'textureKeys', 'glTextures', 'scenes']) assert.equal(results.clean.after[key], results.clean.base[key], `clean: ${key}`);
  assert.equal(sum(results.clean.after.gameEvents), sum(results.clean.base.gameEvents)); assert.equal(sum(results.clean.after.scale), sum(results.clean.base.scale));
  assert.equal(sum(results.clean.after.sceneEvents), sum(results.clean.base.sceneEvents), 'a clean scene leaves no listeners behind');
  ok('ten restarts of a scene with display objects, tween, timer, particles, input, keys and physics: every counter is flat',
    Object.fromEntries(['children', 'tweens', 'timers', 'textureKeys', 'glTextures'].map(k => [k, results.clean.after[k]])));
  assert.equal(grew('events', 'gameEvents', 'postrender'), 10); assert.equal(grew('events', 'scale', 'resize'), 10);
  assert.equal(grew('events', 'sceneEvents', 'update'), 10); assert.equal(grew('events', 'registry', 'changedata'), 10);
  ok('listeners you add to game.events, scale, registry or this.events are not removed by a restart (+10 each)',
    {postrender: grew('events', 'gameEvents', 'postrender'), resize: grew('events', 'scale', 'resize'), update: grew('events', 'sceneEvents', 'update'), changedata: grew('events', 'registry', 'changedata')});
  assert.equal(sum(results.fixed.after.gameEvents), sum(results.fixed.base.gameEvents)); assert.equal(sum(results.fixed.after.sceneEvents), sum(results.fixed.base.sceneEvents));
  assert.equal(sum(results.fixed.after.scale), sum(results.fixed.base.scale)); assert.equal(sum(results.fixed.after.registry), sum(results.fixed.base.registry));
  ok('removing them in a once("shutdown") handler makes the counters flat again');
  assert.equal(results.textures.after.textureKeys - results.textures.base.textureKeys, 10); assert.equal(results.textures.after.glTextures - results.textures.base.glTextures, 10);
  ok('a texture added under a new key per restart grows textureKeys and glTextureWrappers by one each',
    {textureKeys: results.textures.after.textureKeys - results.textures.base.textureKeys, glTextures: results.textures.after.glTextures - results.textures.base.glTextures});

  // Game create and destroy: the ledger of DOM listeners.
  {
    const {page} = await open('');
    const cycle = () => page.evaluate(async () => {
      await new Promise(res => { window.g = new Phaser.Game({type: Phaser.WEBGL, width: 100, height: 100, parent: 'host', banner: false, audio: {noAudio: true}, scene: {create: res}}); });
      await new Promise(res => { window.g.events.once('destroy', () => setTimeout(res, 50)); window.g.destroy(true); });
    });
    for (let i = 0; i < 5; i++) await cycle();
    const left = await page.evaluate(() => ({ledger: window.__ledger(), canvases: document.querySelectorAll('canvas').length}));
    assert.equal(left.ledger['document|visibilitychange'], 5, 'one visibilitychange listener stays per destroyed Game');
    assert.equal(left.canvases, 0);
    ok('five Game create/destroy cycles leave five visibilitychange listeners on document and no canvas', left);
    await page.close();
  }

  // Context loss and restore.
  {
    const body = `window.game = new Phaser.Game({type: Phaser.WEBGL, width: 200, height: 100, banner: false, audio: {noAudio: true}, parent: 'host',
      scene: {create() { this.add.rectangle(0, 0, 100, 100, 0xff0000).setOrigin(0); window.rt = this.add.renderTexture(100, 0, 100, 100).setOrigin(0); window.rt.fill(0x00ff00); window.rt.render();
        const c = this.textures.createCanvas('cv', 8, 8); c.context.fillStyle = '#0f0'; c.context.fillRect(0, 0, 8, 8); c.refresh(); this.add.image(150, 80, 'cv').setScale(2); window.ready = true; }}});`;
    const {page, problems} = await open(body);
    await page.waitForFunction(() => window.ready === true);
    const r = await page.evaluate(async () => {
      const renderer = game.renderer, events = [];
      const px = (x, y) => new Promise(res => renderer.snapshotPixel(x, y, c => res([c.red, c.green, c.blue])));
      const until = test => new Promise((res, rej) => { const t0 = performance.now(); const poll = () => (test() ? res() : performance.now() - t0 > 5000 ? rej(new Error('timeout')) : setTimeout(poll, 5)); poll(); });
      renderer.on('losewebgl', () => events.push('losewebgl')); renderer.on('restorewebgl', () => events.push('restorewebgl'));
      const extension = renderer.gl.getExtension('WEBGL_lose_context');
      await until(() => game.loop.frame > 2); const before = {scene: await px(10, 10), renderTexture: await px(150, 20), canvasTexture: await px(150, 80)};
      extension.loseContext(); await until(() => renderer.contextLost); const lostFlag = renderer.contextLost;
      extension.restoreContext(); await until(() => !renderer.contextLost);
      await until(() => game.loop.frame > 0); await new Promise(res => game.events.once('postrender', res));
      const after = {scene: await px(10, 10), renderTexture: await px(150, 20), canvasTexture: await px(150, 80)};
      window.rt.fill(0x00ff00); window.rt.render(); await new Promise(res => game.events.once('postrender', res));
      return {before, events, lostFlag, after, redrawn: await px(150, 20)};
    });
    assert.deepEqual(r.events, ['losewebgl', 'restorewebgl']); assert.equal(r.lostFlag, true);
    assert.deepEqual(r.after.scene, [255, 0, 0]); assert.deepEqual(r.after.canvasTexture, [0, 255, 0]);
    assert.deepEqual(r.before.renderTexture, [0, 255, 0]); assert.deepEqual(r.after.renderTexture, [0, 0, 0], 'RenderTexture contents do not survive a restore'); assert.deepEqual(r.redrawn, [0, 255, 0], 'drawing it again works');
    assert.ok(problems.some(p => /WebGL Context lost/.test(p)) && problems.some(p => /WebGL Context restored/.test(p)), 'both transitions warn on the console');
    assert.ok(problems.some(p => /INVALID_OPERATION/.test(p)), 'a scene with a RenderTexture also logs INVALID_OPERATION deletes on restore');
    ok('WEBGL_lose_context: scene and CanvasTexture come back, RenderTexture is blank until redrawn, both transitions warn', {...r, warnings: problems.map(p => p.slice(0, 60))});
    await page.close();
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
