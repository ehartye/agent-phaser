// Probe for skills/phaser-motion: which clock drives tweens, timers and animations, plus the traps around them.
//
// Run:  node phaser-motion-clocks.mjs /absolute/path/to/project-with-phaser-and-playwright [/path/to/phaser-4.2.0-package]
//   The project supplies `phaser` 4.2.1 and one of `@playwright/test`, `playwright` or `playwright-core`, with a Chromium
//   install for it. The optional second argument is an extracted `phaser@4.2.0` package (`npm pack phaser@4.2.0`, then
//   unpack it); without it the 4.2.0 chain-delay comparison is skipped.
// Expect: one `ok <id>` line per check and `all checks passed`; the first failed assertion throws.
//   Each id is cited by the `[tested]` labels in the references of skills/phaser-motion.
// Scope: game logic only. It uses the Canvas renderer, plus one WebGL page on a software rasteriser for the pixel-rounding check, and says nothing about
//   GPU correctness or performance. The pause checks wait about three seconds of real time and assume a machine that is not stalling frames.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(join(project, 'package.json'));
const playwright = ['@playwright/test', 'playwright', 'playwright-core'].map(name => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(playwright, 'the project must provide @playwright/test, playwright or playwright-core');
const PHASER_421 = require.resolve('phaser');
const PHASER_420 = process.argv[3] ? join(resolve(process.argv[3]), 'dist', 'phaser.js') : null;
const GL_ARGS = (process.env.PROBE_GL_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ').filter(Boolean);

// In-page helpers. `boot` starts a small game and resolves once its scene exists; `sheet` is a four-frame canvas texture.
const PAGE_HELPERS = `
window.boot = (extra = {}) => new Promise(resolve => {
  const game = new Phaser.Game(Object.assign({
    type: Phaser.CANVAS, width: 64, height: 64, banner: false, audio: { noAudio: true }, backgroundColor: '#000',
    scene: { create() {
      for (const [key, count] of [['sheet', 4], ['hero', 4], ['bad', 2]]) {
        const tex = this.textures.createCanvas(key, 64, 16);
        for (let i = 0; i < count; i++) tex.add(String(i), 0, i * 16, 0, 16, 16);
      }
      window.sc = this; resolve(game);
    } }
  }, extra));
  window.game = game;
});
window.wait = ms => new Promise(r => setTimeout(r, ms));
window.virtual = () => { let t = game.loop.time; return (dt, n = 1) => { for (let i = 0; i < n; i++) { t += dt; game.step(t, dt); } }; };
`;

const browser = await playwright.chromium.launch({ args: GL_ARGS });
let passed = 0;
const ok = (id, detail = '') => { passed++; console.log(`ok ${id}${detail ? ' ' + detail : ''}`); };

async function page(phaserFile, fn, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 200, height: 200 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.setContent('<!doctype html><body style="margin:0"></body>');
  await p.addScriptTag({ path: phaserFile });
  if (clock) await p.clock.install({ time: 0 });
  await p.evaluate(PAGE_HELPERS);
  try { return await fn(p); } finally {
    await context.close();
    assert.deepEqual(errors, [], 'no page errors');
  }
}

try {
  // 1. Hand-driven frames: scene time, timers and animations follow game.step; tweens do not.
  const manual = await page(PHASER_421, p => p.evaluate(async () => {
    await boot();
    game.loop.sleep();
    const step = virtual(), out = { version: Phaser.VERSION }, tm = sc.tweens;
    const idx = s => s.anims.currentFrame.index - 1;
    const changesOf = (s, n, dt) => { const seq = []; for (let i = 0; i < n; i++) { step(dt); seq.push(idx(s)); } const at = []; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) at.push((i + 1) * dt); return at; };

    // clocks
    const o = { v: 0 }, tw = tm.add({ targets: o, v: 100, duration: 1000 });
    let fired = 0; sc.time.delayedCall(500, () => { fired++; });
    const s0 = sc.add.sprite(0, 0, 'sheet');
    sc.anims.create({ key: 'loop4', frames: sc.anims.generateFrameNumbers('sheet', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
    s0.play('loop4'); step(16.667, 70);
    out.clocks = { timerFired: fired, tweenProgress: tw.progress, animIndex: idx(s0) };
    tw.destroy();

    // timers
    let n = 0; sc.time.addEvent({ delay: 100, repeat: 2, callback: () => n++ }); step(100, 10);
    let m = 0; const loopEv = sc.time.addEvent({ delay: 10, loop: true, callback: () => m++ }); step(1000, 1); loopEv.remove();
    let z = false; sc.time.delayedCall(0, () => { z = true; }); const zSync = z; step(16);
    let p = 0; const pe = sc.time.addEvent({ delay: 100, loop: true, callback: () => p++ }); step(100, 2); const p0 = p, now0 = sc.time.now;
    sc.time.paused = true; step(100, 5); const heldCalls = p - p0, nowMoved = Math.round(sc.time.now - now0); sc.time.paused = false; pe.remove();
    let q = 0; sc.time.addEvent({ delay: 100, loop: true, callback: () => q++ }); step(100, 3); const q0 = q;
    sc.scene.pause(); step(100, 5); const scenePausedCalls = q - q0; sc.scene.resume();
    let ts = 0; sc.time.timeScale = 2; sc.time.addEvent({ delay: 100, loop: true, callback: () => ts++ }); step(100, 4); sc.time.timeScale = 1;
    let zeroLoop; try { sc.time.addEvent({ delay: 0, loop: true, callback() {} }); zeroLoop = 'no throw'; } catch (e) { zeroLoop = e.message; }
    out.timers = { repeat2: n, loopIn1000msFrame: m, zeroSync: zSync, zeroAfter: z, heldCalls, nowMoved, scenePausedCalls, timeScale2: ts, zeroLoop };

    // time step
    const loop = game.loop;
    const cool = () => { loop._coolDown = 0; loop.inFocus = true; for (let i = 0; i < 10; i++) loop.smoothDelta(1000 / 60); };
    out.smoothing = { defaults: [loop.smoothStep, loop.deltaSmoothingMax, loop._min, loop.panicMax] };
    loop.resetDelta(); out.smoothing.coolDownCap = loop.smoothDelta(100);
    cool(); out.smoothing.spike = Array.from({ length: 11 }, (_, i) => +loop.smoothDelta(i === 0 ? 100 : 1000 / 60).toFixed(2));
    cool(); out.smoothing.stall = loop.smoothDelta(1000);
    cool(); out.smoothing.under200 = +loop.smoothDelta(150).toFixed(2);
    cool(); loop.inFocus = false; out.smoothing.blurred = +loop.smoothDelta(100).toFixed(2); loop.inFocus = true;
    const seen = []; const cb = loop.callback; loop.callback = (t, d) => seen.push(+d.toFixed(2));
    loop.smoothStep = false; loop.lastTime = 1000; loop.step(1100); loop.step(1200); out.smoothing.rawPassThrough = seen.splice(0); loop.smoothStep = true;
    loop.setFPSLimit(30); out.smoothing.limit = [loop.hasFpsLimit, +loop._limitRate.toFixed(2)];
    cool(); loop.lastTime = 5000; loop.delta = 0; let tt = 5000; for (let i = 0; i < 12; i++) { tt += 1000 / 60; loop.stepLimitFPS(tt); }
    out.smoothing.limitCalls = seen.splice(0); loop.setFPSLimit(0); out.smoothing.limitOff = loop.hasFpsLimit; loop.callback = cb;

    // tweens driven by hand: pause the manager, then call update(); the first update only starts the tween
    tm.pauseAll();
    const a = { x: 0 }, ta = tm.add({ targets: a, x: 100, duration: 1000, persist: true });
    ta.update(500); const first = ta.progress; ta.update(500); const second = ta.progress;
    ta.seek(500); const seek500 = ta.progress; ta.seek(1000); const seek1000 = { progress: ta.progress, state: ta.state }; ta.seek(1030); const seekPlus = ta.state;
    ta.destroy();
    out.manualTween = { first, second, seek500, seek1000, seekPlus };
    const half = () => { const o = { x: 0 }, t = tm.add({ targets: o, x: 100, duration: 1000, persist: true }); t.update(1); t.update(500); return { o, t }; };
    const c1 = half(), c2 = half(); let done = 0; c1.t.on('complete', () => done++); c1.t.complete(); c2.t.forward(5000);
    out.finish = { completeX: c1.o.x, completeEvents: done, forwardX: c2.o.x, forwardState: c2.t.state };

    const r = { x: 0 }, tr = tm.add({ targets: r, x: '+=100', duration: 100, delay: 200 });
    tr.update(1); tr.update(150); r.x = 50; tr.update(100); tr.update(100); tr.update(100); out.relativeEnd = r.x; tr.destroy();

    const ease = {}; for (const [k, e] of [['bogus', 'Sine.easeInOutt'], ['full', 'Sine.easeInOut'], ['short', 'sine.inout']]) { const e1 = { x: 0 }, t1 = tm.add({ targets: e1, x: 100, duration: 1000, ease: e }); t1.update(1); t1.update(250); ease[k] = +e1.x.toFixed(2); t1.destroy(); }
    out.ease = ease;

    const body = sc.add.rectangle(0, 0, 4, 4); let completes = 0, updates = 0;
    const td = tm.add({ targets: body, x: 100, duration: 1000, onComplete: () => completes++, onUpdate: () => updates++ });
    td.update(1); td.update(100); const u1 = updates; body.destroy(); td.update(100);
    out.destroyedTarget = { completes, updatesAfter: updates - u1 };

    const shape = {}; const kind = v => (v && typeof v === 'object') ? v.constructor.name : typeof v;
    const tq = tm.add({ targets: { x: 0 }, x: 10, duration: 100, onUpdate: (...args) => { shape.callback = args.map(kind); } });
    tq.on('update', (...args) => { shape.emitter = args.map(kind); }); tq.update(1); tq.update(50); tq.destroy();
    out.argShapes = shape;

    const run = (cfg, total) => { const t1 = { x: 0 }, log = []; const tt1 = tm.add({ targets: t1, x: 100, duration: 100, onLoop: () => log.push('loop'), onRepeat: () => log.push('repeat'), ...cfg }); tt1.update(1); const xs = []; for (let t = 10; t <= total; t += 10) { tt1.update(10); xs.push(Math.round(t1.x)); } tt1.destroy(); return { xs, log }; };
    out.delayReplay = { loop: run({ delay: 100, loop: 1 }, 450), repeat: run({ delay: 100, repeat: 1 }, 450) };

    let killedComplete = false; const kt = tm.add({ targets: { x: 0 }, x: 1, duration: 1000, onComplete: () => { killedComplete = true; } });
    tm.killAll(); out.killAll = { count: tm.getTweens().length, killedComplete, state: kt.state };
    tm.resumeAll();

    // animations
    sc.anims.create({ key: 'perframe', frames: [{ key: 'sheet', frame: '0', duration: 300 }, { key: 'sheet', frame: '1' }, { key: 'sheet', frame: '2', duration: 50 }, { key: 'sheet', frame: '3' }], frameRate: 10 });
    const pf = sc.add.sprite(0, 0, 'sheet'); pf.play('perframe'); out.perFrame = changesOf(pf, 50, 10);
    const e = sc.add.sprite(0, 0, 'sheet'); e.play({ key: 'perframe', frameRate: 20 }); out.frameRateOverride = changesOf(e, 20, 10);
    const f = sc.add.sprite(0, 0, 'sheet'); f.play({ key: 'perframe', timeScale: 2 }); out.timeScale2 = changesOf(f, 40, 10);
    const c = sc.add.sprite(0, 0, 'sheet'); c.play({ key: 'loop4', duration: 4000 }); out.playConfigDuration = [c.anims.frameRate, c.anims.msPerFrame];
    const w1 = sc.add.sprite(0, 0, 'sheet'), w2 = sc.add.sprite(0, 0, 'sheet'); let stops = 0; w1.on('animationstop', () => stops++);
    for (let i = 0; i < 30; i++) { w1.play('loop4'); w2.play('loop4', true); step(16.667); }
    out.playEveryFrame = { restarted: idx(w1), ignored: idx(w2), stops };
    const sw = sc.add.sprite(0, 0, 'sheet'); sw.play('loop4'); step(10); sw.setTexture('hero', '0'); const swapped = sw.texture.key; step(150);
    out.textureSwap = [swapped, sw.texture.key];
    const mkAse = tags => ({ meta: { frameTags: tags }, frames: { 0: { duration: 100 }, 1: { duration: 100 }, 2: { duration: 200 }, 3: { duration: 100 } } });
    game.cache.json.add('hero', mkAse([{ name: 'walk', from: 0, to: 3, direction: 'forward' }, { name: 'bounce', from: 0, to: 2, direction: 'pingpong' }, { name: 'back', from: 0, to: 2, direction: 'reverse' }, { name: 'pr', from: 0, to: 2, direction: 'pingpong_reverse' }]));
    sc.anims.createFromAseprite('hero');
    const walk = sc.anims.get('walk'), once = sc.add.sprite(0, 0, 'sheet'), looped = sc.add.sprite(0, 0, 'sheet');
    once.play('walk'); looped.play({ key: 'walk', repeat: -1 }); step(10, 200);
    out.aseprite = { repeat: walk.repeat, duration: walk.duration, bounceYoyo: sc.anims.get('bounce').yoyo, pingpongReverseYoyo: sc.anims.get('pr').yoyo, reverseFirst: sc.anims.get('back').frames[0].textureFrame, playingAfter2s: once.anims.isPlaying, frameAfter2s: idx(once), loopingAfter2s: looped.anims.isPlaying };
    game.cache.json.add('bad', { meta: { frameTags: [{ name: 'nodur', from: 0, to: 1 }] }, frames: { 0: {}, 1: {} } });
    out.noDuration = sc.anims.createFromAseprite('bad')[0].duration;
    const base = game.anims.listenerCount('pauseall');
    for (let i = 0; i < 20; i++) { sc.anims.create({ key: 'r' + i, frames: sc.anims.generateFrameNumbers('sheet', { start: 0, end: 3 }), frameRate: 10 }); sc.anims.remove('r' + i); }
    const afterRemove = game.anims.listenerCount('pauseall');
    for (let i = 0; i < 20; i++) { sc.anims.create({ key: 'd' + i, frames: sc.anims.generateFrameNumbers('sheet', { start: 0, end: 3 }), frameRate: 10 }); sc.anims.get('d' + i).destroy(); }
    out.listeners = [base, afterRemove, game.anims.listenerCount('pauseall')];

    // timeline: follows the scene clock, fires in array order
    const log = [], tl = sc.add.timeline([{ at: 300, run: () => log.push('late') }, { at: 100, run: () => log.push('early') }]);
    tl.play(); step(1000, 1); out.timelineOrder = log;

    // curves
    const V = Phaser.Math.Vector2, dist = Phaser.Math.Distance.BetweenPoints;
    const bez = new Phaser.Curves.CubicBezier(new V(0, 0), new V(0, 100), new V(100, 100), new V(100, 0));
    const ratio = pts => { const d = []; for (let i = 1; i < pts.length; i++) d.push(dist(pts[i - 1], pts[i])); return Math.max(...d) / Math.min(...d); };
    out.spacing = [+ratio(bez.getPoints(10)).toFixed(2), +ratio(bez.getSpacedPoints(10)).toFixed(2), bez.getPoints(10).length, bez.getSpacedPoints(10).length];
    const path = new Phaser.Curves.Path(0, 0); path.lineTo(100, 0); path.splineTo([new V(150, 50), new V(200, 0)]);
    const l0 = path.getLength(); path.curves[1].points[1].y = 400; const stale = path.getLength(); path.updateArcLengths(); const pathOnly = path.getLength();
    path.curves[1].updateArcLengths(); path.updateArcLengths(); out.cache = { l0: Math.round(l0), stale: Math.round(stale), pathOnly: Math.round(pathOnly), both: Math.round(path.getLength()) };
    out.pointRange = [!!path.getPoint(1), path.getPoint(1.5), new Phaser.Curves.Path(0, 0).getPoint(0.5)];
    const fp = sc.add.path(0, 0); fp.lineTo(100, 0); const fol = sc.add.follower(fp, 0, 0, 'sheet'); fol.startFollow({ duration: 1000, positionOnPath: true }); step(100, 20);
    out.follower = [fol.x, fol.pathTween.isNumberTween, fol.pathTween.persist];

    // camera shake rounding
    const cam = sc.cameras.main; cam.setZoom(3); out.shake = {};
    for (const rp of [true, false]) { cam.roundPixels = rp; cam.shake(1000, 0.05); const vals = []; for (let i = 0; i < 30; i++) { step(16.667); vals.push(cam.shakeEffect._offsetX); } out.shake[rp] = vals.every(Number.isInteger); cam.shakeEffect.reset(); }

    // whole-pixel rounding inside onUpdate keeps the tween's own value precise
    cam.setZoom(1); const rr = { x: 0 }; const seenX = []; const kept = []; const trr = tm.add({ targets: rr, x: 10, duration: 1000, onUpdate: (tw, target) => { seenX.push(target.x); target.x = Math.round(target.x); kept.push(target.x); } });
    tm.pauseAll(); trr.update(1); for (let i = 0; i < 20; i++) trr.update(50); out.roundInUpdate = { finalX: rr.x, sawFractional: seenX.some(v => !Number.isInteger(v)), keptIntegers: kept.every(Number.isInteger) };
    return out;
  }));

  assert.equal(manual.version, '4.2.1', 'these checks describe Phaser 4.2.1');
  const c = manual.clocks;
  assert.equal(c.timerFired, 1); assert.ok(c.tweenProgress < 0.1); assert.equal(c.animIndex, 3);
  ok('tween-wall-clock', `1167 virtual ms: timer fired ${c.timerFired}, animation frame ${c.animIndex}, tween progress ${c.tweenProgress}`);

  const t = manual.timers;
  assert.equal(t.repeat2, 3); assert.equal(t.loopIn1000msFrame, 100); assert.equal(t.zeroSync, false); assert.equal(t.zeroAfter, true);
  assert.equal(t.heldCalls, 0); assert.equal(t.nowMoved, 500); assert.equal(t.scenePausedCalls, 0); assert.equal(t.timeScale2, 8); assert.match(t.zeroLoop, /zero delay/);
  ok('timer-semantics', JSON.stringify(t));

  const s = manual.smoothing;
  assert.deepEqual(s.defaults, [true, 10, 200, 120]);
  assert.equal(+s.coolDownCap.toFixed(2), 16.67);
  assert.deepEqual(s.spike, [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 16.67]);
  assert.equal(+s.stall.toFixed(2), 16.67); assert.equal(s.under200, 30); assert.equal(s.blurred, 16.67);
  assert.deepEqual(s.rawPassThrough, [100, 100]);
  assert.deepEqual(s.limit, [true, 33.33]); assert.deepEqual(s.limitCalls, [33.33, 33.33, 33.33, 33.33, 33.33, 33.33]); assert.equal(s.limitOff, false);
  ok('timestep-smoothing', `spike ${s.spike.slice(0, 2)}.. stall ${s.stall.toFixed(2)} under200 ${s.under200} cooldown cap ${s.coolDownCap.toFixed(2)}`);
  ok('fps-limit', `30 fps limit from 60 Hz stamps: ${s.limitCalls.length} callbacks of ${s.limitCalls[0]} ms`);

  const mt = manual.manualTween;
  assert.equal(mt.first, 0); assert.equal(mt.second, 0.5);
  assert.ok(Math.abs(mt.seek500 - 0.4834) < 0.001); assert.equal(mt.seek1000.state, 21); assert.ok(mt.seek1000.progress < 1); assert.equal(mt.seekPlus, 27);
  ok('manual-tween-update', `first update progress ${mt.first}, second ${mt.second}, seek(500) ${mt.seek500.toFixed(4)}, seek(1000) state ${mt.seek1000.state}`);
  assert.deepEqual(manual.finish, { completeX: 50, completeEvents: 1, forwardX: 100, forwardState: 27 }); ok('complete-leaves-target-midway', `complete() fired the event with x at ${manual.finish.completeX}; forward(5000) ended at ${manual.finish.forwardX}`);
  assert.equal(manual.relativeEnd, 150); ok('relative-end-resolved-late', 'x: 50 + 100 after the delay');
  assert.equal(manual.ease.bogus, 25); assert.equal(manual.ease.full, manual.ease.short); assert.notEqual(manual.ease.full, 25); ok('unknown-ease-is-linear', JSON.stringify(manual.ease));
  assert.deepEqual(manual.destroyedTarget, { completes: 1, updatesAfter: 0 }); ok('destroyed-target-still-completes');
  assert.deepEqual(manual.argShapes, { emitter: ['Tween', 'string', 'Object', 'number', 'number'], callback: ['Tween', 'Object', 'string', 'number', 'number'] }); ok('update-argument-order');
  const dr = manual.delayReplay; assert.deepEqual(dr.loop.log, ['loop']); assert.deepEqual(dr.repeat.log, ['repeat']);
  assert.equal(dr.loop.xs[24], 0); assert.ok(dr.repeat.xs[24] > 0); ok('loop-replays-delay-repeat-does-not');
  assert.deepEqual(manual.killAll, { count: 0, killedComplete: false, state: 28 }); ok('kill-all-skips-on-complete');

  assert.deepEqual(manual.perFrame.slice(0, 3), [300, 400, 450]); ok('per-frame-duration-replaces', `frame changes at ${manual.perFrame.slice(0, 3)} ms`);
  assert.deepEqual(manual.frameRateOverride, [50, 100, 150]); ok('frame-rate-override-drops-durations');
  assert.deepEqual(manual.timeScale2, [150, 200, 230]); ok('time-scale-keeps-proportions');
  assert.deepEqual(manual.playConfigDuration, [10, 100]); ok('play-config-duration-ignored');
  assert.deepEqual(manual.playEveryFrame, { restarted: 0, ignored: 1, stops: 29 }); ok('play-every-frame-restarts');
  assert.deepEqual(manual.textureSwap, ['hero', 'sheet']); ok('animation-overrides-texture-swap', `setTexture('hero') while playing: ${manual.textureSwap}`);
  const a = manual.aseprite;
  assert.equal(a.repeat, 0); assert.equal(a.duration, 500); assert.equal(a.bounceYoyo, true); assert.equal(a.pingpongReverseYoyo, false); assert.equal(a.reverseFirst, '2');
  assert.equal(a.playingAfter2s, false); assert.equal(a.frameAfter2s, 3); assert.equal(a.loopingAfter2s, true); assert.ok(manual.noDuration > 1e15);
  ok('aseprite-defaults', JSON.stringify(a)); ok('aseprite-missing-duration-freezes', `duration ${manual.noDuration}`);
  assert.deepEqual(manual.listeners.map((v, i) => i === 0 ? 0 : v - manual.listeners[0]), [0, 20, 20]); ok('anims-remove-leaks-listeners', `pauseall listeners ${manual.listeners}`);
  assert.deepEqual(manual.timelineOrder, ['late', 'early']); ok('timeline-array-order');
  assert.ok(manual.spacing[0] > 1.5 && manual.spacing[1] < 1.1); assert.deepEqual(manual.spacing.slice(2), [11, 11]); ok('get-points-not-evenly-spaced', `max/min segment ${manual.spacing.slice(0, 2)}, point counts ${manual.spacing.slice(2)}`);
  assert.deepEqual(manual.cache, { l0: 244, stale: 244, pathOnly: 244, both: 909 }); ok('arc-length-cache-needs-curve-update', JSON.stringify(manual.cache));
  assert.deepEqual(manual.pointRange, [true, null, null]); ok('path-get-point-null');
  assert.ok(manual.follower[0] < 5); assert.deepEqual(manual.follower.slice(1), [true, true]); ok('follower-is-a-persist-counter-tween');
  assert.deepEqual(manual.shake, { true: true, false: false }); ok('camera-shake-rounds-with-round-pixels');
  assert.equal(manual.roundInUpdate.finalX, 10); assert.equal(manual.roundInUpdate.sawFractional, true); assert.equal(manual.roundInUpdate.keptIntegers, true); ok('round-in-on-update');

  // 2. Wall-clock behaviour with the real loop: pausing for less than the 500 ms lag limit does not freeze tweens.
  const live = await page(PHASER_421, p => p.evaluate(async () => {
    await boot();
    const tm = sc.tweens, out = {};
    const gain = async (freeze, thaw, hold) => { const tw = tm.add({ targets: { x: 0 }, x: 1e6, duration: 1e6 }); await wait(100); const e0 = tw.elapsed; freeze(tw); await wait(hold); thaw(tw); await wait(100); const g = Math.round(tw.elapsed - e0); tw.destroy(); return g; };
    out.control = await gain(() => {}, () => {}, 300);
    out.pauseAll300 = await gain(() => tm.pauseAll(), () => tm.resumeAll(), 300);
    out.pauseAll800 = await gain(() => tm.pauseAll(), () => tm.resumeAll(), 800);
    out.tweenPause300 = await gain(tw => tw.pause(), tw => tw.resume(), 300);
    out.globalScale300 = await gain(() => tm.setGlobalTimeScale(0), () => tm.setGlobalTimeScale(1), 300);
    out.sceneSleep300 = await gain(() => sc.scene.sleep(), () => sc.scene.wake(), 300);
    const keep = () => tm.add({ targets: { x: 0 }, x: 1, duration: 50, persist: true });
    const [pa, pb, pc, pd] = [keep(), keep(), keep(), keep()]; await wait(200);
    pa.destroy(); pb.remove(); pc.remove(); pc.destroy(); await wait(100);
    out.persisted = { destroyOnly: tm.has(pa), removeOnly: tm.has(pb), removeThenDestroy: tm.has(pc), untouched: tm.has(pd) };
    pd.remove();
    out.zombies = tm.getTweens().length;
    const pf = sc.add.path(0, 0); pf.lineTo(100, 0); const fol = sc.add.follower(pf, 0, 0, 'sheet');
    for (let i = 0; i < 10; i++) { fol.startFollow({ duration: 100000 }); await wait(20); }
    await wait(60); out.restartsLeft = tm.getTweens().length - out.zombies;
    const fol2 = sc.add.follower(pf, 0, 0, 'sheet'), n0 = tm.getTweens().length;
    fol2.startFollow({ duration: 100000 }); await wait(60); fol2.stopFollow(); fol2.destroy(); await wait(60); out.destroyedFollowerKeeps = tm.getTweens().length - n0;
    const before = tm.getTweens().length;
    for (let i = 0; i < 10; i++) { if (fol.pathTween) fol.pathTween.remove(); fol.startFollow({ duration: 100000 }); await wait(20); }
    await wait(60); out.restartsLeftAfterFix = tm.getTweens().length - before;
    return out;
  }));
  assert.ok(live.pauseAll300 > live.control - 60, 'pauseAll for 300 ms is caught up');
  assert.ok(live.sceneSleep300 > live.control - 60, 'scene sleep for 300 ms is caught up');
  assert.ok(live.pauseAll800 < 250, 'a pause above 500 ms is clamped to the 33 ms lag skip');
  assert.ok(live.tweenPause300 < 200 && live.globalScale300 < 200, 'per-tween pause and global time scale 0 freeze the tween');
  ok('short-pause-catches-up', JSON.stringify({ control: live.control, pauseAll300: live.pauseAll300, pauseAll800: live.pauseAll800, tweenPause300: live.tweenPause300, globalScale300: live.globalScale300, sceneSleep300: live.sceneSleep300 }));
  assert.deepEqual(live.persisted, { destroyOnly: true, removeOnly: false, removeThenDestroy: false, untouched: true });
  ok('destroy-keeps-persisted-tween', JSON.stringify(live.persisted));
  assert.ok(live.restartsLeft >= 10); assert.equal(live.destroyedFollowerKeeps, 1); assert.ok(live.restartsLeftAfterFix <= 1);
  ok('follower-restart-leaks-tweens', `ten restarts leave ${live.restartsLeft} tweens; stopFollow plus destroy keeps ${live.destroyedFollowerKeeps}; removing pathTween before each restart leaves ${live.restartsLeftAfterFix} more`);

  // 3. Playwright's fake clock moves the whole game, tweens included, and a hit stop is a time scale of zero.
  const faked = await page(PHASER_421, async p => {
    await p.evaluate(async () => {
      await boot();
      window.obj = { v: 0 }; window.tw = sc.tweens.add({ targets: obj, v: 100, duration: 1000 });
      window.fired = null; sc.time.delayedCall(500, () => { window.fired = Math.round(sc.time.now); });
      sc.anims.create({ key: 'spin', frames: sc.anims.generateFrameNumbers('sheet', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
      window.spr = sc.add.sprite(0, 0, 'sheet'); spr.play('spin');
      window.hit = ms => { sc.tweens.setGlobalTimeScale(0); sc.anims.globalTimeScale = 0; sc.time.delayedCall(ms, () => { sc.tweens.setGlobalTimeScale(1); sc.anims.globalTimeScale = 1; }); };
    });
    const read = () => p.evaluate(() => ({ progress: tw.progress, fired, scale: sc.tweens.timeScale, frame: spr.anims.currentFrame.index }));
    await p.clock.runFor(600); const half = await read();
    await p.evaluate(() => hit(200)); const start = await read();
    await p.clock.runFor(150); const held = await read();
    await p.clock.runFor(150); const after = await read();
    await p.clock.runFor(1000); const done = await read();
    return { half, start, held, after, done };
  }, { clock: true });
  assert.ok(Math.abs(faked.half.progress - 0.6) < 0.06 && faked.half.fired !== null);
  assert.equal(faked.held.progress, faked.start.progress); assert.equal(faked.held.frame, faked.start.frame); assert.equal(faked.held.scale, 0); assert.equal(faked.after.scale, 1); assert.ok(faked.after.progress > faked.start.progress);
  assert.equal(faked.done.progress, 1);
  ok('page-clock-drives-tweens', `after runFor(600): tween progress ${faked.half.progress}, a 500 ms timer fired at scene time ${faked.half.fired}`); ok('hit-stop-time-scale-zero', `tween held at ${faked.held.progress} and animation held on frame ${faked.held.frame}, then resumed to ${faked.done.progress}`);

  // 3b. Two ways to hand-drive tweens: fast-forwarding the fake clock is clamped, a patched Date.now follows game.step.
  const jump = await page(PHASER_421, async p => {
    await p.evaluate(async () => { await boot(); window.o = { v: 0 }; window.tw = sc.tweens.add({ targets: o, v: 100, duration: 1000 }); });
    await p.clock.fastForward(1000); await p.clock.runFor(100);
    return p.evaluate(() => tw.progress);
  }, { clock: true });
  assert.ok(jump < 0.2); ok('fast-forward-is-clamped', `fastForward(1000) then runFor(100): progress ${jump}`);
  const patched = await page(PHASER_421, p => p.evaluate(async () => {
    await boot(); game.loop.sleep();
    const realNow = Date.now.bind(Date); let vnow = realNow(); Date.now = () => vnow;
    const o = { v: 0 }, tw = sc.tweens.add({ targets: o, v: 100, duration: 1000 }); let t = game.loop.time, half = 0;
    for (let i = 0; i < 80; i++) { t += 16.667; vnow += 16.667; game.step(t, 16.667); if (i === 29) half = tw.progress; }
    Date.now = realNow; return { half, final: tw.progress };
  }));
  assert.ok(Math.abs(patched.half - 0.48) < 0.03 && patched.final === 1); ok('date-now-patch-drives-tweens', `progress ${patched.half.toFixed(3)} after 30 frames of 16.667 ms, then ${patched.final}`);

  // 4. TweenChain `delay`: stuck in START_DELAY on 4.2.0, fixed on 4.2.1.
  const chain = file => page(file, async p => {
    await p.evaluate(async () => { await boot(); window.a = { v: 0 }; window.chain = sc.tweens.chain({ targets: a, delay: 100, tweens: [{ v: 10, duration: 100 }] }); window.initial = chain.state; });
    await p.clock.runFor(1000);
    return p.evaluate(() => ({ version: Phaser.VERSION, initial, state: chain.state, v: a.v }));
  }, { clock: true });
  const fixed = await chain(PHASER_421);
  assert.deepEqual([fixed.initial, fixed.v], [24, 10]); assert.equal(fixed.state, 28);
  ok('chain-delay-4.2.1', `${fixed.version}: chain reached v ${fixed.v}`);
  if (PHASER_420) {
    const old = await chain(PHASER_420);
    assert.equal(old.version, '4.2.0'); assert.deepEqual([old.state, old.v], [24, 0]);
    ok('chain-delay-4.2.0-stuck', `${old.version}: chain stays in state ${old.state}, v ${old.v}`);
  } else console.log('skip chain-delay-4.2.0-stuck (no 4.2.0 package given)');

  // 5. Rounding: a translated sprite is snapped, a sprite with any rotation or scale is not (WebGL, software rasteriser).
  const px = await page(PHASER_421, p => p.evaluate(async () => {
    await boot({ type: Phaser.WEBGL, pixelArt: true });
    game.loop.sleep(); const step = virtual(), out = {};
    const g = sc.make.graphics({ add: false }); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 4); g.generateTexture('blk', 4, 4); g.destroy();
    const gl = game.renderer.gl;
    const cols = y => { const buf = new Uint8Array(4 * 64); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 63 - y, 64, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); const lit = []; for (let x = 0; x < 64; x++) if (buf[x * 4] > 127) lit.push(x); return lit[0]; };
    const img = sc.add.image(10.5, 10.5, 'blk').setOrigin(0, 0);
    step(16); out.translated = cols(12);
    img.setRotation(0.0001); step(16); out.rotated = cols(12);
    img.setRotation(0).setScale(1.0001); step(16); out.scaled = cols(12);
    img.setScale(1).setVertexRoundMode('full').setRotation(0.0001); step(16); out.full = cols(12);
    out.webgl = game.renderer.type === Phaser.WEBGL;
    out.pixelArtRounds = [game.config.roundPixels, sc.cameras.main.roundPixels];
    return out;
  }));
  assert.equal(px.webgl, true, 'WebGL renderer'); assert.deepEqual(px.pixelArtRounds, [true, true]);
  assert.equal(px.translated, 11); assert.equal(px.rotated, 10); assert.equal(px.scaled, 10); assert.equal(px.full, 11);
  ok('rotation-or-scale-drops-vertex-rounding', `first lit column at x=10.5: translated ${px.translated}, rotated ${px.rotated}, scaled ${px.scaled}, full round mode ${px.full}`);

  // 6. Reduced motion is a media query the page can read; Playwright can emulate it.
  const rm = await page(PHASER_421, async p => {
    await p.emulateMedia({ reducedMotion: 'reduce' });
    return p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  });
  assert.equal(rm, true); ok('reduced-motion-emulation');
  console.log(`all checks passed (${passed})`);
} finally {
  await browser.close();
}
