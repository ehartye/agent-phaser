// Run: node phaser-verification-driving.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove which clocks drive which Phaser 4.2.1 systems, so a test can pick a deterministic way to drive a game
// (phaser-verification/references/deterministic-test-driving.md). It checks that input is applied at the DOM event, that game.step() drives the scene clock and Arcade
// physics on the virtual time you pass but NOT tweens (the tween manager reads Date.now()), that Playwright's page.clock drives
// everything including tweens, that Phaser.HEADLESS needs headlessStep(), and that only Phaser.Math.RND is seeded.
// Needs: phaser 4.2.1 and @playwright/test in the host project and a Chromium. No GPU is needed (software WebGL is fine).
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
window.game = new Phaser.Game(Object.assign({banner: false, width: 100, height: 100, audio: {noAudio: true}}, ${config}));
</script>`;
let currentConfig = '{}';
const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); }
  else { res.setHeader('content-type', 'text/html'); res.end(html(currentConfig)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = false;
const ok = (name, detail) => console.log(`ok   ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);

// A scene with one tween (1000 ms), one timer (1000 ms), one Arcade body under gravity 100, and a frame counter.
const driven = `{type: Phaser.CANVAS, physics: {default: 'arcade', arcade: {gravity: {y: 100}}}, scene: class extends Phaser.Scene {
  create() {
    window.box = this.add.rectangle(0, 0, 10, 10, 0xff);
    window.tw = this.tweens.add({targets: window.box, x: 100, duration: 1000});
    window.fired = 0; this.time.addEvent({delay: 1000, callback: () => { window.fired++; }});
    window.body = this.physics.add.existing(this.add.rectangle(0, 0, 4, 4, 0xff)).body;
    window.frames = 0; this.events.on('update', () => { window.frames++; });
    window.renders = 0; game.events.on('postrender', () => { window.renders++; }); window.rendersAtCreate = window.renders;
    window.key = this.input.keyboard.addKey('SPACE'); window.keyEvents = 0; this.input.keyboard.on('keydown-SPACE', () => { window.keyEvents++; });
    window.pointerDowns = []; this.input.on('pointerdown', p => { window.pointerDowns.push([Math.round(p.x), Math.round(p.y)]); });
    window.ready = true;
  } }}`;

async function open(config, {clock = false, init} = {}) {
  currentConfig = config;
  const page = await browser.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  if (init) await page.addInitScript(init);
  if (clock) { await page.clock.install({time: 0}); await page.clock.pauseAt(1000); }   // paused before the page loads: nothing ticks until runFor
  await page.goto(origin);
  await page.waitForFunction(() => window.ready === true);
  return {page, problems};
}

try {
  // 1. game.step on a virtual clock: scene clock and physics follow it, tweens do not.
  {
    const {page} = await open(driven);
    const r = await page.evaluate(() => {
      game.loop.sleep();
      const t0 = performance.now(); let t = game.loop.now;
      for (let i = 0; i < 60; i++) { t += 1000 / 60; game.step(t, 1000 / 60); }
      return {realMs: +(performance.now() - t0).toFixed(1), tweenProgress: +window.tw.progress.toFixed(3), timerFired: window.fired, bodyY: +window.body.y.toFixed(1)};
    });
    assert.ok(r.realMs < 500, 'sixty virtual frames take almost no real time');
    assert.equal(r.timerFired, 1, 'the scene clock follows the virtual time');
    assert.ok(r.bodyY > 40 && r.bodyY < 60, 'Arcade integrates the virtual delta (0.5 * 100 * 1 s squared is 50)');
    assert.ok(r.tweenProgress < 0.2, 'the tween manager reads Date.now(), so one virtual second moved the tween almost nothing');
    ok('game.step(): Clock and Arcade follow virtual time, tweens follow the wall clock', r);
    await page.close();
  }

  // 1b. Input is applied when the DOM event arrives, not at the next step; ready is not drawn.
  {
    const {page} = await open(driven);
    await page.evaluate(() => { game.loop.sleep(); window.step = () => game.step(performance.now(), 16); });
    const r = {};
    r.rendersAtCreate = await page.evaluate(() => window.rendersAtCreate);
    await page.keyboard.down('Space');
    r.afterKeyDown = await page.evaluate(() => ({isDown: window.key.isDown, handlerRuns: window.keyEvents}));
    await page.keyboard.up('Space');
    r.pressAndReleaseBetweenSteps = await page.evaluate(() => ({isDown: window.key.isDown, justDown: Phaser.Input.Keyboard.JustDown(window.key), justUp: Phaser.Input.Keyboard.JustUp(window.key)}));
    const dispatch = () => page.evaluate(() => {
      window.key.reset(); window.keyEvents = 0; window.pointerDowns.length = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space', key: ' ', keyCode: 32}));
      const rect = game.canvas.getBoundingClientRect();
      game.canvas.dispatchEvent(new MouseEvent('mousedown', {clientX: rect.left + 40, clientY: rect.top + 60, button: 0, bubbles: true}));
      return {isDown: window.key.isDown, handlerRuns: window.keyEvents, pointerDowns: window.pointerDowns.slice(), queued: game.input.keyboard.queue.length};
    });
    r.syntheticWithoutAFrame = await dispatch();       // the earlier real events are still queued
    await page.evaluate(() => window.step());           // POST_STEP clears the keyboard queue
    r.syntheticAfterAFrame = await dispatch();
    assert.equal(r.syntheticWithoutAFrame.handlerRuns, 2, 'with no frame between events the queued keydown is delivered again');
    assert.deepEqual(r.syntheticAfterAFrame, {isDown: true, handlerRuns: 1, pointerDowns: [[40, 60]], queued: 1}, 'after a frame a dispatched DOM event is delivered once');
    assert.equal(r.rendersAtCreate, 0, 'create() runs before the first render');
    assert.deepEqual(r.afterKeyDown, {isDown: true, handlerRuns: 1}, 'a key press is applied at the event, with no step');
    assert.deepEqual(r.pressAndReleaseBetweenSteps, {isDown: false, justDown: false, justUp: true}, 'polling isDown and JustDown miss a press and release; only the event handler and JustUp saw it');
    ok('input: applied at the DOM event; polling misses a press and release between steps; without a frame the keyboard queue re-delivers old keys', r);
    await page.close();
  }

  // 2. page.clock drives rAF, Date, performance and therefore tweens. Installed and paused before goto, two runs are identical.
  {
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const {page} = await open(driven, {clock: true});
      const sample = async () => page.evaluate(() => ({frames: window.frames, tweenX: +window.box.x.toFixed(2), fired: window.fired, now: Date.now()}));
      const start = await sample();
      await page.clock.runFor(500); const half = await sample();
      await page.clock.runFor(600); const done = await sample();
      runs.push({start, half, done}); await page.close();
    }
    assert.deepEqual(runs[0], runs[1], 'two paused-clock runs are identical');
    const {half, done, start} = runs[0];
    assert.equal(start.frames, 0); assert.ok(half.tweenX > 35 && half.tweenX < 65, 'half a second of fake time moves the tween about half way');
    assert.equal(done.tweenX, 100); assert.equal(done.fired, 1);
    assert.equal(done.now - start.now, 1100, 'runFor advanced exactly 1100 ms');
    ok('page.clock install + pauseAt before goto, then runFor: frames, tween and timer are identical in two runs', runs[0]);
  }

  // 3. Phaser.HEADLESS has no renderer: step() throws, headlessStep() works.
  {
    const {page} = await open(driven.replace('Phaser.CANVAS', 'Phaser.HEADLESS'));
    const r = await page.evaluate(() => {
      game.loop.sleep(); const out = {renderer: game.renderer, canvasInDom: document.querySelectorAll('canvas').length};
      try { game.step(1, 16); out.step = 'ok'; } catch (e) { out.step = e.message; }
      let t = game.loop.now; for (let i = 0; i < 60; i++) { t += 1000 / 60; game.headlessStep(t, 1000 / 60); }
      out.bodyY = +window.body.y.toFixed(1); out.frames = window.frames; return out;
    });
    assert.equal(r.renderer, null); assert.match(r.step, /preRender/); assert.ok(r.bodyY > 40 && r.bodyY < 60);
    ok('Phaser.HEADLESS: game.step() throws, headlessStep() simulates', r);
    await page.close();
  }

  // 4. Seeds: only Phaser.Math.RND (and its helpers) follows the config seed; Between and Shuffle use Math.random.
  {
    const config = `{type: Phaser.HEADLESS, seed: ['fixed'], scene: class extends Phaser.Scene { create() {
      window.seq = {rnd: [Phaser.Math.RND.between(0, 1e6), Phaser.Math.RND.between(0, 1e6)], plain: [Phaser.Math.Between(0, 1e6), Phaser.Math.Between(0, 1e6)]};
      window.ready = true; } }}`;
    const seeded = [], pinned = [];
    for (let i = 0; i < 2; i++) {
      const a = await open(config); seeded.push(await a.page.evaluate(() => window.seq)); await a.page.close();
      // Replacing Math.random before Phaser loads makes the unseeded helpers repeatable too.
      const b = await open(config, {init: () => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }});
      pinned.push(await b.page.evaluate(() => window.seq)); await b.page.close();
    }
    assert.deepEqual(seeded[0].rnd, seeded[1].rnd, 'RND repeats with a config seed');
    assert.notDeepEqual(seeded[0].plain, seeded[1].plain, 'Phaser.Math.Between is not seeded');
    assert.deepEqual(pinned[0], pinned[1], 'a pinned Math.random makes both repeat');
    ok('seed: RND repeats, Math.Between does not, a pinned Math.random fixes both', {seeded, pinned});
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
