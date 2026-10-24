// Run: node phaser-audio-manager.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove the Phaser 4.2.1 sound-manager behaviours that phaser-audio/references/sound-manager-in-4x.md and
// spatial-and-mix.md claim: unlock timing, the per-frame resume, blur and focus, manager choice, decoded length,
// output levels (pan, volume, mute) and the listener-position traps.
// Needs: phaser 4.2.1 and @playwright/test in the host project, and a Chromium (headless is fine; no GPU needed, the game
// uses the Canvas renderer). The game is booted from a page script and the first gesture is a real mouse click, because
// Playwright's page.evaluate counts as user activation and would hide the locked state.
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
if (!/4\.2\.1/.test(String(JSON.parse(readFileSync(resolve(project, 'node_modules/phaser/package.json'), 'utf8')).version))) {
  console.log('note: these checks were written against phaser 4.2.1');
}

const page_html = `<!doctype html><meta charset=utf-8><body style="margin:0"><script src="/phaser.js"></script><script>
function wav(sec, hz, rate) { const n = Math.floor(sec * rate), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 0.5 * 32767), true); return b; }
const audio = new URLSearchParams(location.search).get('audio');
window.game = new Phaser.Game({ type: Phaser.CANVAS, width: 200, height: 100, parent: document.body,
  audio: audio === 'none' ? { noAudio: true } : audio === 'html5' ? { disableWebAudio: true } : {},
  scene: { create() { window.ready = true; } } });
</script>`;

// Server-side WAV bytes for the loader check: a half-second sine at 22050 Hz.
const toneWav = (() => {
  const rate = 22050, n = rate / 2, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 0.5 * 32767), 44 + i * 2);
  return b;
})();
const loaderPage = `<!doctype html><meta charset=utf-8><body><script src="/phaser.js"></script><script>
window.log = [];
class S extends Phaser.Scene {
  preload() {
    this.load.on('loaderror', f => log.push('loaderror:' + f.key));
    this.load.on('filecomplete', k => log.push('filecomplete:' + k));
    this.load.once('complete', (l, ok, failed) => log.push('complete ok=' + ok + ' failed=' + failed + ' totalFailed=' + this.load.totalFailed));
    this.load.audio('good', '/audio/tone.wav');
    this.load.audio('missing', '/audio/nope.wav');
    this.load.audio('garbage', '/audio/garbage.wav');
    this.load.audio('noext', '/audio/tone');
    this.load.audio('typed', [{url: '/audio/tone', type: 'wav'}]);
    this.load.audio('fallback', ['/audio/tone.unknown', '/audio/tone.wav']);
  }
  create() { window.ready = true; }
}
window.game = new Phaser.Game({type: Phaser.CANVAS, width: 100, height: 100, banner: false, scene: S});
</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); }
  else if (req.url === '/audio/tone.wav' || req.url === '/audio/tone') { res.setHeader('content-type', 'audio/wav'); res.end(toneWav); }
  else if (req.url === '/audio/garbage.wav') { res.setHeader('content-type', 'audio/wav'); res.end(Buffer.alloc(300, 7)); }
  else if (req.url.startsWith('/audio/')) { res.statusCode = 404; res.end('missing'); }
  else if (req.url.startsWith('/loader')) { res.setHeader('content-type', 'text/html'); res.end(loaderPage); }
  else { res.setHeader('content-type', 'text/html'); res.end(page_html); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = false;
const ok = (name, detail) => console.log(`ok   ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`);

async function open(query = '') {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.goto(origin + query);
  await page.waitForFunction(() => window.ready === true);
  return {page, problems};
}
// In-page helpers: wait on the audio clock or a condition, never on a fixed wall-clock sleep.
const helpers = () => {
  window.audioFor = sec => new Promise(done => {
    const ctx = game.sound.context, t0 = ctx.currentTime;
    const poll = () => (ctx.currentTime - t0 >= sec ? done() : setTimeout(poll, 5));
    poll();
  });
  window.rafs = n => new Promise(done => { let i = 0; const tick = () => (++i >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
  window.until = (test, ms = 3000) => new Promise((done, fail) => {
    const t0 = performance.now();
    const poll = () => (test() ? done() : performance.now() - t0 > ms ? fail(new Error('until timed out: ' + test)) : setTimeout(poll, 5));
    poll();
  });
};

try {
  // 1. Manager choice and the headless-test trap of noAudio.
  {
    const none = await open('?audio=none');
    const r = await none.page.evaluate(() => {
      const s = game.sound; const out = {kind: s.constructor.name, locked: s.locked, hasContext: 'context' in s};
      out.addMissing = s.add('missing') ? 'ok' : 'null'; out.managerPlay = s.play('missing');
      return out;
    });
    assert.equal(r.kind, 'NoAudioSoundManager'); assert.equal(r.locked, false); assert.equal(r.hasContext, false);
    assert.equal(r.addMissing, 'ok', 'NoAudio accepts a key that is not in the cache'); assert.equal(r.managerPlay, false);
    ok('noAudio manager hides a missing audio key', r);
    const web = await open();
    const w = await web.page.evaluate(() => {
      const s = game.sound; const out = {kind: s.constructor.name, locked: s.locked, state: s.context.state};
      try { s.add('missing'); out.addMissing = 'ok'; } catch (e) { out.addMissing = e.message; }
      return out;
    });
    assert.equal(w.kind, 'WebAudioSoundManager'); assert.equal(w.locked, true); assert.equal(w.state, 'suspended');
    assert.match(w.addMissing, /not found in cache/);
    ok('WebAudio manager is locked and suspended at boot and throws on a missing key', w);
    const html5 = await open('?audio=html5');
    const h = await html5.page.evaluate(() => ({kind: game.sound.constructor.name, hasContext: 'context' in game.sound}));
    assert.equal(h.kind, 'HTML5AudioSoundManager'); assert.equal(h.hasContext, false);
    ok('audio.disableWebAudio selects the HTML5 manager', h);
    await none.page.close(); await web.page.close(); await html5.page.close();
  }

  // 1b. Which gestures unlock: Phaser listens for touchstart, touchend, mousedown, mouseup and keydown on document.body.
  {
    const result = {};
    for (const gesture of ['mouse', 'key', 'touch', 'pointerdown only']) {
      const page = await browser.newPage({hasTouch: true, viewport: {width: 300, height: 200}});
      await page.goto(origin); await page.waitForFunction(() => window.ready === true); await page.evaluate(helpers);
      if (gesture === 'mouse') await page.mouse.click(50, 50);
      if (gesture === 'key') await page.keyboard.press('Space');
      if (gesture === 'touch') await page.touchscreen.tap(50, 50);
      if (gesture === 'pointerdown only') {
        await page.evaluate(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); await rafs(20); });
        result[gesture] = await page.evaluate(() => game.sound.context.state);
      } else {
        await page.waitForFunction(() => game.sound.context.state === 'running'); result[gesture] = 'running';
      }
      await page.close();
    }
    assert.deepEqual(result, {mouse: 'running', key: 'running', touch: 'running', 'pointerdown only': 'suspended'});
    ok('mouse, key and touch gestures unlock the context; a bare pointerdown does not', result);
  }

  // 2. Unlock timing, per-frame resume, blur and focus.
  const {page, problems} = await open();
  await page.evaluate(helpers);
  await page.evaluate(() => { window.unlockedEvents = 0; game.sound.on('unlocked', () => window.unlockedEvents++); game.loop.sleep(); });
  await page.mouse.click(50, 50);
  await page.waitForFunction(() => game.sound.context.state === 'running' && game.sound.unlocked === true);
  const slept = await page.evaluate(() => ({locked: game.sound.locked, events: window.unlockedEvents}));
  assert.deepEqual(slept, {locked: true, events: 0}, 'with the loop asleep the context runs but Phaser still says locked');
  const stepped = await page.evaluate(() => { game.step(performance.now(), 16); return {locked: game.sound.locked, events: window.unlockedEvents}; });
  assert.deepEqual(stepped, {locked: false, events: 1}, 'one frame clears locked and emits unlocked');
  ok('UNLOCKED is emitted from the next PRE_STEP, not at the gesture', {slept, stepped});

  const resumed = await page.evaluate(async () => {
    const ctx = game.sound.context; await ctx.suspend(); const afterSuspend = ctx.state;
    game.step(performance.now(), 16); await until(() => ctx.state === 'running'); return {afterSuspend, afterOneStep: ctx.state};
  });
  assert.deepEqual(resumed, {afterSuspend: 'suspended', afterOneStep: 'running'});
  ok('a manual context.suspend() is undone by the next frame', resumed);

  const blur = await page.evaluate(async () => {
    const ctx = game.sound.context, r = {};
    game.events.emit('blur'); await until(() => ctx.state === 'suspended'); r.afterBlur = ctx.state;
    game.step(performance.now(), 16); await rafs(10); r.stepWhileBlurred = ctx.state;
    game.events.emit('focus'); await until(() => ctx.state === 'running'); r.afterFocus = ctx.state;
    game.sound.pauseOnBlur = false; game.events.emit('blur'); r.pauseOnBlurFalse = ctx.state; game.events.emit('focus'); game.sound.pauseOnBlur = true;
    return r;
  });
  assert.deepEqual(blur, {afterBlur: 'suspended', stepWhileBlurred: 'suspended', afterFocus: 'running', pauseOnBlurFalse: 'running'});
  ok('blur suspends, frames do not resume while blurred, focus resumes, pauseOnBlur=false keeps running (synthetic events)', blur);

  const hidden = await page.evaluate(() => {
    const seen = []; game.events.on('pause', () => seen.push('pause')); game.events.on('resume', () => seen.push('resume'));
    const set = value => { Object.defineProperty(document, 'hidden', {get: () => value, configurable: true}); document.dispatchEvent(new Event('visibilitychange')); };
    set(true); set(false); return seen;
  });
  assert.deepEqual(hidden, ['pause', 'resume']);
  ok('overriding document.hidden and dispatching visibilitychange drives the game pause and resume events', hidden);

  // 3. Decode: length is in context frames; a bad file logs, is not cached, and rejects uncaught.
  const decode = await page.evaluate(async () => {
    const s = game.sound, done = new Promise(res => s.once('decodedall', res));
    s.decodeAudio([{key: 'tone', data: wav(1, 440, 22050)}]); await done;
    const b = game.cache.audio.get('tone'); return {length: b.length, bufferRate: b.sampleRate, contextRate: s.context.sampleRate};
  });
  assert.equal(decode.length, Math.round(decode.contextRate * 1), 'a 1 s file decodes to one second of context frames');
  ok('decoded length is in the context sample rate (a 22050 Hz file)', decode);
  const before = problems.length;
  const bad = await page.evaluate(async () => {
    const s = game.sound, done = new Promise(res => s.once('decodedall', res)); s.decodeAudio('bad', new ArrayBuffer(200)); await done;
    return {cached: game.cache.audio.exists('bad')};
  });
  assert.equal(bad.cached, false);
  await page.evaluate(() => rafs(10));
  const badProblems = problems.slice(before);
  assert.ok(badProblems.some(p => /^pageerror: Unable to decode audio data/.test(p)), 'manager.decodeAudio leaves the decode rejection uncaught');
  ok('a failed decodeAudio is not cached and its rejection is uncaught (the decode patch covers AudioFile only)', {bad, badProblems});

  // 3b. The loader: unknown extensions, 404, an undecodable 200, and the typed and fallback URL forms.
  {
    const loader = await browser.newPage(); const messages = [];
    loader.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') messages.push(m.text()); });
    loader.on('pageerror', e => messages.push(`pageerror: ${e.message}`));
    await loader.goto(origin + 'loader'); await loader.waitForFunction(() => window.ready === true);
    const r = await loader.evaluate(() => ({log: window.log, cached: ['good', 'missing', 'garbage', 'noext', 'typed', 'fallback'].filter(k => game.cache.audio.exists(k))}));
    assert.deepEqual(r.cached, ['good', 'typed', 'fallback']);
    assert.ok(r.log.includes('loaderror:missing') && !r.log.some(l => /garbage|noext/.test(l)), 'only the 404 raises loaderror; the garbage file and the no-extension URL raise none');
    assert.ok(r.log.some(l => /^complete ok=4 failed=1 totalFailed=1$/.test(l)), 'the undecodable file counts among the completed ones');
    assert.ok(messages.some(m => /No audio URLs for .* can play on this device/.test(m)), 'a URL with no extension is skipped with a warning');
    assert.ok(messages.some(m => /Error decoding audio: garbage/.test(m)));
    ok('loader: 404 raises loaderror; an undecodable 200 is counted complete and missing from the cache; a URL with no extension is dropped unless typed', {...r, messages: messages.map(m => m.slice(0, 80))});
    await loader.close();
  }

  // 4. Output levels through an analyser on the master gain: pan, volume, mute.
  await page.evaluate(() => {
    const ctx = game.sound.context, split = ctx.createChannelSplitter(2); game.sound.masterVolumeNode.connect(split);
    const tap = i => { const a = ctx.createAnalyser(); a.fftSize = 2048; split.connect(a, i); return a; };
    const L = tap(0), R = tap(1);
    const peak = a => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return Math.max(...d.map(Math.abs)); };
    window.lr = () => [peak(L), peak(R)].map(v => +v.toFixed(3));
  });
  const mix = await page.evaluate(async () => {
    const s = game.sound, t = s.add('tone', {loop: true}), r = {}; t.play();
    await audioFor(0.15); r.center = lr();
    t.pan = -1; await audioFor(0.15); r.panLeft = lr();
    t.pan = 0; s.volume = 0.5; await audioFor(0.15); r.globalHalf = lr(); s.volume = 1;
    s.mute = true; await audioFor(0.15); r.globalMute = lr(); s.mute = false;
    t.volume = 0.25; await audioFor(0.15); r.soundQuarter = lr();
    t.stop(); t.destroy(); return r;
  });
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
  assert.ok(near(mix.center[0], 0.354) && near(mix.center[1], 0.354), 'centre pan is -3 dB per channel for a mono source');
  assert.ok(near(mix.panLeft[0], 0.707) && mix.panLeft[1] === 0, 'hard left: left channel at full level, right silent');
  assert.ok(near(mix.globalHalf[0], mix.center[0] / 2), 'global volume 0.5 halves the output');
  assert.deepEqual(mix.globalMute, [0, 0]);
  assert.ok(near(mix.soundQuarter[0], mix.center[0] / 4));
  ok('analyser on masterVolumeNode reads pan, volume and mute as numbers', mix);

  // 5. Listener position traps (needs the frame loop running: the manager applies the listener in update).
  const listener = await page.evaluate(async () => {
    const s = game.sound, L = s.context.listener, r = {};
    game.loop.wake();
    const peakOf = async source => {
      const t = s.add('tone', source ? {loop: true, source} : {loop: true}); t.play(); await audioFor(0.2);
      const p = Math.max(...lr()); t.stop(); t.destroy(); return p;
    };
    r.noListenerMove = await peakOf(undefined);
    s.setListenerPosition(100, 100); await audioFor(0.1); r.listenerAt100 = [L.positionX.value, L.positionY.value];
    s.setListenerPosition(0, 0); await audioFor(0.1); r.listenerAfterZero = [L.positionX.value, L.positionY.value];
    s.setListenerPosition(400, 300); await audioFor(0.1);
    r.plainSoundAfterMove = await peakOf(undefined);
    r.sourceAtListener = await peakOf({x: 400, y: 300, refDistance: 50});
    const target = {x: 300, y: 10}, t = s.add('tone', {loop: true, source: {follow: target, refDistance: 50}}); t.play(); await audioFor(0.1);
    target.x = 0; target.y = 20; await audioFor(0.1); r.followAfterX0 = [t.spatialNode.positionX.value, t.spatialNode.positionY.value];
    t.stop(); t.destroy(); return r;
  });
  assert.deepEqual(listener.listenerAfterZero, [100, 100], 'a listener coordinate of 0 is ignored by update()');
  assert.ok(listener.plainSoundAfterMove < listener.noListenerMove / 100, 'a sound with no source is nearly silent once the listener leaves the origin');
  assert.ok(near(listener.sourceAtListener, listener.noListenerMove), 'a sound whose source sits at the listener keeps full level');
  assert.deepEqual(listener.followAfterX0, [300, 20], 'a follow target at x=0 is ignored, y still updates');
  ok('listener and follow traps', listener);

  const noise = problems.filter(p => !/Error decoding audio: bad/.test(p) && !/Unable to decode audio data/.test(p));
  assert.deepEqual(noise, [], 'no unexpected console errors');
  console.log('all checks passed');
} catch (error) {
  failed = true;
  console.error('FAILED:', error.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
