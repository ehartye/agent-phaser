// Probe for skills/phaser-motion/references/scene-transitions.md and cutscenes.md (Phaser 4.2.1): scene transitions and Timeline cutscenes.
//
// Run:  node phaser-motion-scenes.mjs /absolute/path/to/project-with-phaser-and-playwright
//   The project supplies `phaser` 4.2.1 and one of `@playwright/test`, `playwright` or `playwright-core`, with a Chromium install for it.
// Expect: one `ok <id>` line per check and `all checks passed`; the first failed assertion throws. Each id is cited by the `[tested]` labels
//   in the two references. Game logic only: the Canvas renderer, hand-stepped frames (`game.loop.sleep()` then `game.step`), and one
//   Playwright fake-clock run for the wall-clock tween case. It says nothing about GPU correctness or performance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(join(project, 'package.json'));
const playwright = ['@playwright/test', 'playwright', 'playwright-core'].map(name => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(playwright, 'the project must provide @playwright/test, playwright or playwright-core');
const PHASER = require.resolve('phaser');
const options = process.argv.slice(3);
let mutation = null, outputRoot = tmpdir();
for (let i = 0; i < options.length; i += 2) {
  const value = options[i + 1];
  assert.ok(value, `${options[i]} requires a value`);
  if (options[i] === '--mutation') mutation = value;
  else if (options[i] === '--out') outputRoot = resolve(value);
  else throw new Error(`Unknown option: ${options[i]}`);
}
assert.ok(mutation === null || ['transition-order', 'repeat-count'].includes(mutation), 'unknown mutation');
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, 'motion-scenes-'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// Expected observations are declared before any native callback is captured. Mutations change native configuration, never these oracles.
const transitionRows = ['fresh', 'sleeping'].flatMap(target => [false, true].flatMap(moveBelow => ['default', 'custom'].map(scope => ({ target, moveBelow, scope }))));
const repeatRows = [{ amount: 0, runs: 1, loops: 0 }, { amount: 1, runs: 2, loops: 1 }, { amount: 2, runs: 3, loops: 2 }, { amount: -1, runs: 3, loops: 2 }, { amount: -2, runs: 1, loops: 0 }];
for (const row of transitionRows) {
  row.expectedOrder = row.moveBelow ? ['B', 'A'] : ['A', 'B'];
  row.expectedEvents = row.target === 'fresh'
    ? ['B.init', 'B.create', 'B.transitionstart', 'onStart', 'A.transitionout', 'B.transitioncomplete', 'A.shutdown']
    : ['B.wake', 'B.transitionwake', 'onStart', 'A.transitionout', 'B.transitioncomplete', 'A.shutdown'];
}
for (const row of repeatRows) {
  row.expectedTrace = [];
  for (let iteration = 0; iteration < row.runs; iteration++) {
    if (iteration) row.expectedTrace.push({ event: 'loop', scope: true, iteration });
    row.expectedTrace.push({ event: 'run', scope: true, iteration });
    if (!iteration) row.expectedTrace.push({ event: 'once', scope: true, iteration });
    row.expectedTrace.push({ event: 'tail', scope: true, iteration });
  }
  if (row.amount !== -1) row.expectedTrace.push({ event: 'complete' });
}
const report = { format: 'phaser-motion-scenes@1', mutation, output, source: { probe: hash(fileURLToPath(import.meta.url)), phaser: hash(PHASER) }, expected: { transitionRows, repeatRows }, observations: [], cleanup: [], checks: [] };
const save = () => writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
save();

// In-page helpers. `start` boots a game whose first scene is 'A' (and optionally more, added but not started) and resolves once it is ready;
// `stepper` returns step(dt, n) over the game's own virtual clock; `click` sends a real mouse down and up to the middle of the canvas.
const PAGE_HELPERS = `
window.ownedGames = [];
window.mkScene = (name, log) => class extends Phaser.Scene {
  constructor() { super(name); }
  init(data) { log?.push(name + '.init ' + JSON.stringify(data)); }
  create() {
    log?.push(name + '.create'); this.hits = 0; this.ticks = 0;
    for (const n of ['transitionout', 'transitionstart', 'transitioncomplete', 'transitionwake', 'shutdown', 'sleep', 'wake']) {
      this.events.on(n, (...args) => log?.push(name + '.' + n + (n === 'transitionstart' || n === 'transitionout' || n === 'transitionwake' ? ' ' + (n === 'transitionwake' ? args[1] : args[1]) : '')));
    }
    this.add.rectangle(100, 100, 200, 200, 0xff0000).setInteractive().on('pointerdown', () => { this.hits++; });
    this.events.on('update', () => { this.ticks++; });
  }
};
window.start = async (names, log) => {
  const game = new Phaser.Game({ type: Phaser.CANVAS, width: 200, height: 200, banner: false, audio: { noAudio: true }, scene: [mkScene(names[0], log)] });
  window.game = game;
  ownedGames.push(game);
  await new Promise(r => game.events.once('ready', r));
  for (const n of names.slice(1)) game.scene.add(n, mkScene(n, log), false);
  game.loop.sleep();
  return game;
};
window.stepper = () => { let t = game.loop.time; return (dt, n = 1) => { for (let i = 0; i < n; i++) { t += dt; game.step(t, dt); } }; };
window.click = () => { const c = game.canvas, rc = c.getBoundingClientRect(); for (const ty of ['mousedown', 'mouseup']) c.dispatchEvent(new MouseEvent(ty, { clientX: rc.left + 100, clientY: rc.top + 100, bubbles: true, button: 0, buttons: ty === 'mousedown' ? 1 : 0 })); };
`;

const browser = await playwright.chromium.launch({ timeout: 15000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let passed = 0;
const ok = (id, detail = '') => { passed++; report.checks.push(id); save(); console.log(`ok ${id}${detail ? ' ' + detail : ''}`); };

async function page(fn, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 200, height: 200 } });
  let p, timer, failure;
  const errors = [], cleanup = { contextClosed: false, games: [] };
  try {
  p = await context.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', e => errors.push(e.message));
  await p.setContent('<!doctype html><body style="margin:0"></body>');
  await p.addScriptTag({ path: PHASER });
  assert.equal(await p.evaluate(() => Phaser.VERSION), '4.2.1', 'pinned native version');
  if (clock) { await p.clock.install({ time: 0 }); await p.clock.pauseAt(1000); }   // paused before the game exists: nothing ticks until runFor
  await p.evaluate(PAGE_HELPERS);
  const result = await Promise.race([fn(p), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Motion case exceeded 15000 ms')), 15000); })]);
  report.observations.push(result); save();
  return result;
  } catch (error) { failure = error; report.failure = error.stack; save(); throw error; }
  finally {
    clearTimeout(timer);
    try {
      if (p && !p.isClosed()) cleanup.games = await p.evaluate(() => (window.ownedGames ?? []).map(game => {
        const canvas = game.canvas, manager = game.scene;
        game.loop.sleep(); game.destroy(true, false); game.step(0, 0);
        return { canvasConnected: canvas.isConnected, scenes: manager.scenes.length, pendingDestroy: game.pendingDestroy, loopRunning: game.loop.running, listeners: game.events.eventNames().length };
      }));
      for (const state of cleanup.games) assert.deepEqual(state, { canvasConnected: false, scenes: 0, pendingDestroy: false, loopRunning: false, listeners: 0 }, 'owned game cleanup');
      assert.deepEqual(errors, [], 'no page errors');
    } catch (error) { cleanup.error = error.stack; if (!failure) failure = error; }
    finally { await context.close(); cleanup.contextClosed = true; report.cleanup.push(cleanup); save(); }
    if (failure) throw failure;
  }
}

try {
  // 1. Events, data and duration of a transition, driven by hand-stepped frames: the duration is measured in scene time.
  {
    const r = await page(p => p.evaluate(async () => {
      const log = [];
      await start(['A', 'B'], log);
      const step = stepper();
      step(16.67, 3);
      const A = game.scene.getScene('A'), progress = [];
      A.scene.transition({ target: 'B', duration: 300, data: { from: 'A', n: 7 }, onUpdate: v => progress.push(+v.toFixed(2)) });
      let frames = 0;
      while (A.sys.isTransitioning() && frames < 100) { step(16.67); frames++; }
      return { log, frames, progress: [progress[0], progress[progress.length - 1]], count: progress.length };
    }));
    assert.deepEqual(r.log, ['A.init {}', 'A.create', 'B.init {"from":"A","n":7}', 'B.create', 'B.transitionstart 300', 'A.transitionout 300', 'B.transitioncomplete', 'A.shutdown']);
    assert.equal(r.frames, 18, '300 ms at 16.67 ms a frame is 18 frames');
    assert.deepEqual([r.count, r.progress[1]], [18, 1], 'onUpdate runs once a frame and ends at exactly 1');
    ok('scene-transition-events-and-data', JSON.stringify(r));
  }

  // 2. Both scenes update for the whole transition, and the outgoing one ends in the state the config asks for.
  {
    const states = await page(async p => {
      const out = {};
      for (const [label, cfg] of Object.entries({ plain: {}, sleep: { sleep: true }, remove: { remove: true } })) {
        out[label] = await p.evaluate(async cfg => {
          await start(['A', 'B']); const step = stepper(); step(16.67, 3);
          const A = game.scene.getScene('A'), B = game.scene.getScene('B');
          A.scene.transition({ target: 'B', duration: 300, ...cfg });
          const a0 = A.ticks, b0 = B.ticks;
          step(16.67, 10);
          const during = { A: A.ticks - a0, B: B.ticks - b0, aTransitioning: A.sys.isTransitioning(), bTransitioning: B.sys.isTransitioning() };
          step(16.67, 10);
          return { during, A: game.scene.getScene('A') ? A.sys.settings.status : 'removed', B: B.sys.settings.status, keys: game.scene.scenes.map(s => s.sys.settings.key) };
        }, cfg);
      }
      return out;
    });
    for (const label of ['plain', 'sleep', 'remove']) {
      assert.equal(states[label].during.A, 10, `${label}: the outgoing scene keeps updating`);
      assert.equal(states[label].during.B, 10, `${label}: the incoming scene updates from its first frame`);
      assert.equal(states[label].B, 5, `${label}: the target ends RUNNING`);
    }
    assert.equal(states.plain.A, 8, 'plain: the outgoing scene is shut down (SHUTDOWN) and stays registered');
    assert.deepEqual(states.plain.keys, ['A', 'B']);
    assert.equal(states.sleep.A, 7, 'sleep: the outgoing scene sleeps (SLEEPING)');
    assert.equal(states.remove.A, 'removed', 'remove: the outgoing scene is removed from the manager');
    assert.deepEqual(states.remove.keys, ['B']);
    ok('scene-transition-end-states', JSON.stringify(states));
  }

  // 3. Input during a transition: off for both scenes unless allowInput is set; then the top scene takes the click.
  {
    const r = await page(async p => {
      const out = {};
      for (const [label, cfg] of Object.entries({ plain: {}, allowInput: { allowInput: true } })) {
        out[label] = await p.evaluate(async cfg => {
          await start(['A', 'B']); const step = stepper(); step(16.67, 3);
          const A = game.scene.getScene('A');
          click(); step(16.67);
          const control = A.hits;                                           // a click on a running scene registers
          A.scene.transition({ target: 'B', duration: 300, ...cfg });
          step(16.67, 2);
          const B = game.scene.getScene('B');
          click(); step(16.67);
          return { control, aHits: A.hits - control, bHits: B.hits, aInput: A.sys.input.enabled, bInput: B.sys.input.enabled };
        }, cfg);
      }
      return out;
    });
    assert.equal(r.plain.control, 1);
    assert.deepEqual([r.plain.aHits, r.plain.bHits, r.plain.aInput, r.plain.bInput], [0, 0, false, false], 'default: no scene gets input during the transition');
    assert.deepEqual([r.allowInput.aHits, r.allowInput.bHits, r.allowInput.aInput, r.allowInput.bInput], [0, 1, true, true], 'allowInput: input is on for both and the top scene takes the click');
    ok('scene-transition-input', JSON.stringify(r));
  }

  // 4. A sleeping target is woken, not restarted: transitionwake fires, init and create do not run again.
  {
    const r = await page(p => p.evaluate(async () => {
      const log = [];
      await start(['A', 'B'], log); const step = stepper(); step(16.67, 2);
      game.scene.start('B'); step(16.67, 2); game.scene.sleep('B'); step(16.67, 2);
      log.length = 0;
      const A = game.scene.getScene('A');
      A.scene.transition({ target: 'B', duration: 100, data: { again: true } });
      step(16.67, 10);
      return { log, status: game.scene.getScene('B').sys.settings.status };
    }));
    assert.ok(r.log.includes('B.transitionwake 100'), JSON.stringify(r.log));
    assert.ok(!r.log.some(l => l.startsWith('B.init') || l === 'B.create'), 'init and create do not run again');
    assert.equal(r.status, 5);
    ok('scene-transition-wakes-a-sleeping-target', JSON.stringify(r));
  }

  // 5. moveAbove draws the outgoing scene over the target, and the default leaves the order alone.
  {
    const r = await page(async p => {
      const out = {};
      for (const [label, cfg] of Object.entries({ default: {}, moveAbove: { moveAbove: true } })) {
        out[label] = await p.evaluate(async cfg => {
          await start(['A', 'B']); const step = stepper(); step(16.67, 2);
          game.scene.sendToBack('B');
          const before = game.scene.scenes.map(s => s.sys.settings.key);
          game.scene.getScene('A').scene.transition({ target: 'B', duration: 100, ...cfg });
          step(16.67, 2);
          return { before, during: game.scene.scenes.map(s => s.sys.settings.key) };
        }, cfg);
      }
      return out;
    });
    assert.deepEqual(r.default.before, ['B', 'A']);
    assert.deepEqual(r.default.during, ['B', 'A'], 'default: the order is unchanged (the target is drawn under the outgoing scene)');
    assert.deepEqual(r.moveAbove.during, ['A', 'B'], 'moveAbove: the target moves above the outgoing scene');
    ok('scene-transition-move-above', JSON.stringify(r));
  }

  // 6. Timeline events fire on the scene clock, in array order, with set, if, once, event and stop.
  {
    const r = await page(p => p.evaluate(async () => {
      await start(['A']); const step = stepper(); step(16.67, 2);
      const A = game.scene.getScene('A'), log = [], target = { v: 0, w: 0 };
      const tl = A.add.timeline([
        { at: 0, run: () => log.push('run0') },
        { at: 100, event: 'cue', target },
        { at: 100, set: { v: 5 }, target },
        { at: 200, if: () => false, run: () => log.push('guarded') },
        { at: 300, once: true, run: () => log.push('once300') },
        { at: 400, run: () => log.push('run400'), stop: true },
        { at: 500, run: () => log.push('never') },
      ]);
      tl.on('cue', t => log.push('cue:' + (t === target)));
      const idle = tl.isPlaying();
      tl.play();
      const frames = {};
      for (let i = 1; i <= 40; i++) { step(16.67); for (const l of log) if (!(l in frames)) frames[l] = i; }
      return { idle, log, frames, v: target.v, complete: tl.complete, paused: tl.paused, eventsLeft: tl.events.length, progress: +tl.getProgress().toFixed(2) };
    }));
    assert.equal(r.idle, false, 'a timeline starts paused until play()');
    assert.deepEqual(r.log, ['run0', 'cue:true', 'once300', 'run400'], 'guarded and later events do not run');
    assert.equal(r.v, 5, 'set writes to the target');
    assert.ok(r.frames['cue:true'] >= 6 && r.frames['cue:true'] <= 7, `an event at 100 ms fires on frame 6 or 7 (${r.frames['cue:true']})`);
    assert.equal(r.complete, true, 'stop: true ends the timeline');
    assert.equal(r.eventsLeft, 6, 'only the once event is removed after it fires');
    ok('timeline-fires-on-scene-clock', JSON.stringify(r));
  }

  // 7. Pause holds elapsed time; resume continues; stop() fires nothing.
  {
    const r = await page(p => p.evaluate(async () => {
      await start(['A']); const step = stepper(); step(16.67, 2);
      const A = game.scene.getScene('A'), log = [];
      const tl = A.add.timeline([{ at: 100, run: () => log.push('a') }, { at: 300, run: () => log.push('b') }]);
      tl.play(); step(16.67, 8);
      const e1 = tl.elapsed; tl.pause(); step(16.67, 30);
      const heldElapsed = tl.elapsed - e1, heldLog = log.slice();
      tl.resume(); step(16.67, 20);
      const tl2 = A.add.timeline([{ at: 100, run: () => log.push('c') }]);
      tl2.play(); step(16.67, 2); tl2.stop(); step(16.67, 20);
      return { heldElapsed, heldLog, log, stopped: { complete: tl2.complete, paused: tl2.paused } };
    }));
    assert.equal(r.heldElapsed, 0, 'pause() holds elapsed');
    assert.deepEqual(r.heldLog, ['a']);
    assert.deepEqual(r.log, ['a', 'b'], 'resume() continues from where it paused; stop() fires nothing');
    assert.deepEqual(r.stopped, { complete: true, paused: true });
    ok('timeline-pause-resume-stop', JSON.stringify(r));
  }

  // 8. Skipping: stop() leaves events unfired; a large timeScale for one frame fires them all in array order; tween events then need forward().
  {
    const r = await page(p => p.evaluate(async () => {
      await start(['A']); const step = stepper(); step(16.67, 2);
      const A = game.scene.getScene('A'), log = [], thing = { x: 0 };
      const build = () => A.add.timeline([
        { at: 0, run: () => log.push('r0') },
        { at: 500, tween: { targets: thing, x: 100, duration: 1000 } },
        { at: 1500, run: () => log.push('r1500') },
      ]);
      const stopped = build(); stopped.play(); step(16.67); stopped.stop(); step(16.67, 5);
      const afterStop = log.slice(); log.length = 0; thing.x = 0;
      const tl = build(); tl.play(); step(16.67);
      tl.timeScale = 1e6; step(16.67);                                         // one frame fires every remaining event, in array order
      const afterSkip = { log: log.slice(), complete: tl.complete, tweenX: thing.x, hasTween: !!tl.events[1].tweenInstance };
      const tween = tl.events[1].tweenInstance;
      tween.forward(tween.totalDuration); const afterFirstForward = thing.x;      // the first forward() only starts a fresh tween
      tween.forward(tween.totalDuration); const afterSecondForward = thing.x;     // the second lands it
      // The recipe as the reference shows it: set timeScale, and forward each tween twice at the end of the frame that fired the steps.
      log.length = 0; thing.x = 0;
      const tl2 = build(); tl2.play(); step(16.67);
      A.events.once('postupdate', () => { for (const ev of tl2.events) { const tw = ev.tweenInstance; if (tw) { tw.forward(tw.totalDuration); tw.forward(tw.totalDuration); } } });
      tl2.timeScale = 1e6; step(16.67);
      return { afterStop, afterSkip, afterFirstForward, afterSecondForward, recipe: { x: thing.x, log: log.slice(), complete: tl2.complete } };
    }));
    assert.deepEqual(r.afterStop, ['r0'], 'stop() leaves later events unfired');
    assert.deepEqual(r.afterSkip.log, ['r0', 'r1500']);
    assert.equal(r.afterSkip.complete, true);
    assert.equal(r.afterSkip.hasTween, true);
    assert.ok(r.afterSkip.tweenX < 50, `the tween event starts a wall-clock tween that has barely moved (${r.afterSkip.tweenX})`);
    assert.equal(r.afterFirstForward, 0, 'the first forward() on a fresh tween does not move it');
    assert.equal(r.afterSecondForward, 100, 'the second forward(totalDuration) lands it on its end value');
    assert.deepEqual(r.recipe, { x: 100, log: ['r0', 'r1500'], complete: true }, 'timeScale plus two forward() calls at postupdate skips the whole cutscene in one frame');
    ok('timeline-skip', JSON.stringify(r));
  }

  // 9. A tween: event is a wall-clock tween: hand-stepped scene time fires the event but does not move the target.
  {
    const r = await page(p => p.evaluate(async () => {
      await start(['A']); const step = stepper(); step(16.67, 2);
      const A = game.scene.getScene('A'), thing = { x: 0 };
      const tl = A.add.timeline([{ at: 0, tween: { targets: thing, x: 100, duration: 1000 } }]);
      tl.play(); step(16.67, 90);                                              // 1.5 s of scene time
      return { elapsed: Math.round(tl.elapsed), x: thing.x, tweenExists: !!tl.events[0].tweenInstance };
    }));
    assert.ok(r.elapsed >= 1400, `scene time passed (${r.elapsed} ms)`);
    assert.equal(r.tweenExists, true);
    assert.ok(r.x < 20, `the target barely moved (${r.x}) because tweens read the wall clock`);
    ok('timeline-tween-event-is-wall-clock', JSON.stringify(r));
  }

  // 10. Under Playwright's fake clock the same timeline, tween events included, is deterministic.
  {
    const runs = [];
    for (let i = 0; i < 2; i++) {
      runs.push(await page(async p => {
        await p.evaluate(async () => {
          await new Promise(resolve => {
            const game = new Phaser.Game({ type: Phaser.CANVAS, width: 64, height: 64, banner: false, audio: { noAudio: true }, scene: { create() {
              window.sc = this; window.thing = { x: 0 }; window.log = [];
              window.tl = this.add.timeline([{ at: 0, tween: { targets: window.thing, x: 100, duration: 1000 } }, { at: 1200, run: () => log.push('end') }]);
              window.tl.play(); resolve();
            } } });
            window.game = game;
            ownedGames.push(game);
          });
        });
        await p.clock.runFor(500); const half = await p.evaluate(() => ({ x: Math.round(thing.x * 100) / 100, log: log.slice() }));
        await p.clock.runFor(1000); const end = await p.evaluate(() => ({ x: thing.x, log: log.slice() }));
        return { half, end };
      }, { clock: true }));
    }
    assert.deepEqual(runs[0], runs[1], 'two fake-clock runs are identical');
    assert.ok(runs[0].half.x > 30 && runs[0].half.x < 70, `about half way at 500 ms (${runs[0].half.x})`);
    assert.deepEqual(runs[0].end, { x: 100, log: ['end'] });
    ok('timeline-under-page-clock', JSON.stringify(runs[0]));
  }

  // 11. forward() on a fresh tween: the first call does not move it, the second lands it (a plain tweens.add, not only a timeline's).
  {
    const r = await page(p => p.evaluate(async () => {
      await start(['A']); const step = stepper(); step(16.67, 2);
      const A = game.scene.getScene('A'), thing = { x: 0 };
      const tween = A.tweens.add({ targets: thing, x: 100, duration: 1000 });
      tween.forward(tween.totalDuration); const first = thing.x;
      tween.forward(tween.totalDuration); const second = thing.x;
      return { first, second };
    }));
    assert.deepEqual(r, { first: 0, second: 100 });
    ok('tween-forward-fresh-needs-two-calls', JSON.stringify(r));
  }

  // 12. Fresh/sleeping targets, native list order and onStart scope/data. No asynchronous loader is installed here.
  for (const row of transitionRows) {
    const { expectedOrder, expectedEvents } = row;
    const r = await page(p => p.evaluate(async ({ row, mutation }) => {
      await start(['A', 'B']); const step = stepper(); step(10, 2);
      const A = game.scene.getScene('A'), B = game.scene.getScene('B'), trace = [], data = { row: `${row.target}/${row.moveBelow}/${row.scope}`, n: 7 };
      if (row.target === 'sleeping') { game.scene.start('B'); step(10, 2); game.scene.sleep('B'); step(10, 2); }
      const order = () => game.scene.scenes.map(s => s.sys.settings.key);
      const emit = (event, extra = {}) => trace.push({ event, order: order(), ...extra });
      const originalInit = B.init, originalCreate = B.create;
      B.init = function (value) { emit('B.init', { data: value, sameData: value === data }); return originalInit.call(this, value); };
      B.create = function (...args) { emit('B.create'); return originalCreate.apply(this, args); };
      B.events.on('wake', (systems, value) => emit('B.wake', { data: value, sameData: value === data, sameSystems: systems === B.sys }));
      for (const event of ['transitionstart', 'transitionwake']) B.events.on(event, (from, duration) => emit(`B.${event}`, { from: from.sys.settings.key, duration }));
      B.events.on('transitioncomplete', () => emit('B.transitioncomplete'));
      A.events.on('transitionout', (to, duration) => emit('A.transitionout', { to: to.sys.settings.key, duration }));
      A.events.on('shutdown', () => emit('A.shutdown'));
      const customScope = { label: 'custom' }, before = { order: order(), targetStatus: B.sys.settings.status };
      const config = {
        target: 'B', duration: 40, data,
        // Wrong native ordering is visible to the same list/order witnesses as the healthy case.
        moveBelow: mutation === 'transition-order' && row.moveBelow ? false : row.moveBelow,
        onStart(from, to, duration) {
          emit('onStart', { from: from.sys.settings.key, to: to.sys.settings.key, duration, sameFrom: from === A, sameTo: to === B,
            scope: this === customScope ? 'custom' : this === A ? 'default' : 'wrong', statuses: [A.sys.settings.status, B.sys.settings.status],
            transitioning: [A.sys.isTransitioning(), B.sys.isTransitioning()] });
        },
        ...(row.scope === 'custom' ? { onStartScope: customScope } : {}),
      };
      const admitted = A.scene.transition(config), immediate = trace.slice();
      let frames = 0;
      while (A.sys.isTransitioning() && frames < 10) { step(10); frames++; }
      return { row, before, admitted, immediate, trace, frames, final: { order: order(), statuses: [A.sys.settings.status, B.sys.settings.status], transitioning: [A.sys.isTransitioning(), B.sys.isTransitioning()] } };
    }, { row, mutation }));
    assert.deepEqual(r.before.order, ['A', 'B']);
    assert.equal(r.before.targetStatus, row.target === 'sleeping' ? 7 : 1);
    assert.equal(r.admitted, true);
    assert.deepEqual(r.trace.map(v => v.event), expectedEvents, 'transition callback order');
    for (const event of r.trace) assert.deepEqual(event.order, expectedOrder, 'transition native scene order');
    assert.deepEqual(r.immediate.map(v => v.event), expectedEvents.slice(0, -2), 'synchronous fixture start/wake precedes onStart and transitionout');
    const received = r.trace[0];
    assert.deepEqual(received.data, { row: `${row.target}/${row.moveBelow}/${row.scope}`, n: 7 });
    assert.equal(received.sameData, true, 'init/wake receives the original data');
    if (row.target === 'sleeping') assert.equal(received.sameSystems, true);
    const callback = r.trace.find(v => v.event === 'onStart');
    assert.deepEqual(callback, { event: 'onStart', order: expectedOrder, from: 'A', to: 'B', duration: 40, sameFrom: true, sameTo: true, scope: row.scope, statuses: [5, 5], transitioning: [true, true] });
    assert.equal(r.frames, 4);
    assert.deepEqual(r.final, { order: expectedOrder, statuses: [8, 5], transitioning: [false, false] });
  }
  ok('scene-transition-order-scope-matrix', '8 fresh/sleeping, moveBelow and scope rows');

  // 13. Independent finite counts, bounded infinite cancellation, distinct -2 and full reset after each row.
  for (const row of repeatRows) {
    const r = await page(p => p.evaluate(async ({ row, mutation }) => {
      await start(['A']); const step = stepper(); step(10, 2);
      const A = game.scene.getScene('A'), trace = [], target = { label: 'target' };
      const tl = A.add.timeline([
        { at: 0, target, loop() { trace.push({ event: 'loop', scope: this === target, iteration: tl.iteration }); }, run() { trace.push({ event: 'run', scope: this === target, iteration: tl.iteration }); } },
        { at: 10, once: true, run() { trace.push({ event: 'once', scope: this === tl, iteration: tl.iteration }); } },
        { at: 20, run() { trace.push({ event: 'tail', scope: this === tl, iteration: tl.iteration }); } },
      ]);
      tl.on('complete', () => trace.push({ event: 'complete' }));
      const actualRepeat = mutation === 'repeat-count' && row.amount === 0 ? 1 : row.amount;
      tl.repeat(actualRepeat).play();
      let frames = 0;
      while (!tl.complete && frames < 20) {
        step(10); frames++;
        if (row.amount === -1 && trace.filter(v => v.event === 'tail').length === 3) break;
      }
      const state = () => ({ complete: tl.complete, paused: tl.paused, playing: tl.isPlaying(), iteration: tl.iteration, events: tl.events.map(e => ({ time: e.time, repeat: e.repeat, complete: e.complete })) });
      const beforeStop = state(), original = trace.slice();
      tl.stop(); const afterStop = state(); step(10, 5); const afterStopTrace = trace.slice();
      // Full reset clears remaining event repeat counters but cannot recreate the removed once event.
      tl.repeat(0).reset(); const afterReset = state(); trace.length = 0;
      step(10, 4); const resetTrace = trace.slice(), resetFinal = state();
      return { amount: row.amount, actualRepeat, frames, original, beforeStop, afterStop, afterStopTrace, afterReset, resetTrace, resetFinal };
    }, { row, mutation }));
    assert.deepEqual(r.original, row.expectedTrace, 'timeline repeat callback counts/order');
    assert.equal(r.original.filter(v => v.event === 'loop').length, row.loops);
    assert.equal(r.frames, row.runs * 2, 'two ten-ms frames per twenty-ms cycle');
    assert.equal(r.beforeStop.complete, row.amount !== -1);
    assert.equal(r.beforeStop.iteration, row.amount === -1 ? 3 : row.loops);
    assert.equal(r.beforeStop.events.length, 2, 'once event is removed');
    assert.deepEqual(r.beforeStop.events.map(v => v.repeat), [row.loops, row.loops]);
    assert.deepEqual(r.afterStopTrace, r.original, 'bounded cancellation fires nothing later');
    assert.equal(r.afterStop.complete, true); assert.equal(r.afterStop.paused, true); assert.equal(r.afterStop.playing, false);
    assert.deepEqual(r.afterReset, { complete: false, paused: false, playing: true, iteration: 0, events: [{ time: 0, repeat: 0, complete: false }, { time: 20, repeat: 0, complete: false }] });
    assert.deepEqual(r.resetTrace, [{ event: 'run', scope: true, iteration: 0 }, { event: 'tail', scope: true, iteration: 0 }, { event: 'complete' }], 'reset clears loop callbacks and does not resurrect once');
    assert.equal(r.resetFinal.complete, true);
  }
  ok('timeline-repeat-boundaries', 'repeat 0/1/2/-1/-2, event loops, once removal and reset');

  console.log(`all checks passed (${passed})`);
} catch (error) {
  report.failure = error.stack; save(); throw error;
} finally {
  await browser.close();
  report.browserClosed = !browser.isConnected(); save();
  console.log(`evidence ${output}`);
}
