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

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(join(project, 'package.json'));
const playwright = ['@playwright/test', 'playwright', 'playwright-core'].map(name => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(playwright, 'the project must provide @playwright/test, playwright or playwright-core');
const PHASER = require.resolve('phaser');

// In-page helpers. `start` boots a game whose first scene is 'A' (and optionally more, added but not started) and resolves once it is ready;
// `stepper` returns step(dt, n) over the game's own virtual clock; `click` sends a real mouse down and up to the middle of the canvas.
const PAGE_HELPERS = `
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
  await new Promise(r => game.events.once('ready', r));
  for (const n of names.slice(1)) game.scene.add(n, mkScene(n, log), false);
  game.loop.sleep();
  return game;
};
window.stepper = () => { let t = game.loop.time; return (dt, n = 1) => { for (let i = 0; i < n; i++) { t += dt; game.step(t, dt); } }; };
window.click = () => { const c = game.canvas, rc = c.getBoundingClientRect(); for (const ty of ['mousedown', 'mouseup']) c.dispatchEvent(new MouseEvent(ty, { clientX: rc.left + 100, clientY: rc.top + 100, bubbles: true, button: 0, buttons: ty === 'mousedown' ? 1 : 0 })); };
`;

const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let passed = 0;
const ok = (id, detail = '') => { passed++; console.log(`ok ${id}${detail ? ' ' + detail : ''}`); };

async function page(fn, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 200, height: 200 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.setContent('<!doctype html><body style="margin:0"></body>');
  await p.addScriptTag({ path: PHASER });
  if (clock) { await p.clock.install({ time: 0 }); await p.clock.pauseAt(1000); }   // paused before the game exists: nothing ticks until runFor
  await p.evaluate(PAGE_HELPERS);
  try { return await fn(p); } finally {
    await context.close();
    assert.deepEqual(errors, [], 'no page errors');
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

  console.log(`all checks passed (${passed})`);
} finally {
  await browser.close();
}
