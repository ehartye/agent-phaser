// Run: node phaser-audio-sounds.mjs /absolute/path/to/project-with-phaser-and-playwright
// Purpose: prove the Phaser 4.2.1 sound-instance behaviours that phaser-audio/references/sounds-markers-and-sprites.md,
// loops-and-scene-lifetime.md and testing-audio.md claim: per-play config that sticks, a volume getter that lags, fire-and-forget
// sounds that leak when stopped, markers and audio sprites, loops that need frames, scene restarts that stack music, and a
// tween that outlives a destroyed sound.
// Needs: phaser 4.2.1 and @playwright/test in the host project, and a Chromium (headless is fine; the game uses the Canvas
// renderer). The committed PCM sprite fixture comes from released agent-beeps 0.36.0. Waits use the audio clock or page conditions.
// Optional: --mutation sprite-range|sprite-source|sprite-loop; --evidence-dir <new-directory> retains native windows and cleanup.
// Expected output: one "ok" line per check with the measured numbers, then "all checks passed"; exit code 1 on a failure.
import assert from 'node:assert/strict';
import http from 'node:http';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {markersFromSections} from '../../../skills/phaser-audio/scripts/assets/beeps-markers.mjs';
import {spritemapFromMap} from '../../../skills/phaser-audio/scripts/assets/beeps-spritemap.mjs';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const {chromium} = require('@playwright/test');
assert.equal(require('phaser/package.json').version, '4.2.1', 'this native probe requires Phaser 4.2.1');
const phaserJs = readFileSync(require.resolve('phaser'));
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const mutation = flag('--mutation');
assert.ok(mutation === undefined || ['sprite-range', 'sprite-source', 'sprite-loop'].includes(mutation), 'unknown mutation');
const evidenceDir = flag('--evidence-dir');
if (evidenceDir) { assert.equal(existsSync(evidenceDir), false, 'evidence directory must be new'); mkdirSync(evidenceDir, {recursive: true}); }
const evidence = {mutation: mutation ?? null, identities: {}, checks: [], cleanup: {pages: [], browserCreated: false}};
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/audio-sprite');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let spriteBytes, convertedSprite;

function admitFixture() {
  const provenance = JSON.parse(readFileSync(resolve(fixture, 'provenance.json')));
  assert.equal(provenance.producer.version, '0.36.0');
  assert.equal(provenance.producer.revision, '377a95eeabbac7da2609dc4aa0862bb9b1bffeae');
  const mapBytes = readFileSync(resolve(fixture, 'tones.sprite.json'));
  assert.equal(sha256(mapBytes), '96b4e910677cafc75ae06b94a54e2b2004db15eda0659558f2d92789cb9f7f37', 'sprite map byte authentication');
  const map = JSON.parse(mapBytes);
  spriteBytes = readFileSync(resolve(fixture, 'tones.wav'));
  if (mutation === 'sprite-source') { spriteBytes = Buffer.from(spriteBytes); spriteBytes[44] ^= 1; }
  evidence.identities = {producer: provenance.producer, mapSha256: sha256(mapBytes), wavSha256: sha256(spriteBytes)};
  assert.equal(sha256(spriteBytes), '97e443c0ed0531cb68815a849e03264f24f37a23f3e7d31d7836b205ed7c1280', 'sprite source byte authentication');
  assert.equal(map.audio.sha256, sha256(spriteBytes), 'packed bytes agree with producer map');
  convertedSprite = spritemapFromMap(map, ['/tones.wav']);
  assert.deepEqual([map.sampleRate, map.channels, map.frames, map.gapFrames], [48000, 1, 81600, 4800]);
  const ranges = [[0, 24000], [28800, 52800], [57600, 81600]];
  for (const [i, id] of ['low', 'mid', 'high'].entries()) {
    const source = readFileSync(resolve(fixture, id + '.wav'));
    assert.equal(sha256(source), provenance.files[id + '.wav'].sha256, 'source PCM identity');
    assert.equal(map.entries[i].sourceSha256, sha256(source));
    assert.deepEqual([map.entries[i].startFrame, map.entries[i].endFrame], ranges[i]);
    assert.deepEqual(spriteBytes.subarray(44 + ranges[i][0] * 2, 44 + ranges[i][1] * 2), source.subarray(44), 'exact source PCM range');
    if (i < 2) assert.ok(spriteBytes.subarray(44 + ranges[i][1] * 2, 44 + ranges[i + 1][0] * 2).every(v => v === 0), 'silent PCM gap');
  }
  evidence.authenticated = true;
  // These controls deliberately change the converted playback plan only after valid producer admission.
  if (mutation === 'sprite-range') convertedSprite.spritemap.low = {...convertedSprite.spritemap.mid};
  if (mutation === 'sprite-loop') convertedSprite.spritemap.high.loop = false;
}

const pageHtml = `<!doctype html><meta charset=utf-8><body style="margin:0"><script src="/phaser.js"></script><script>
function wav(sec, hz, rate) { const n = Math.floor(sec * rate), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 0.5 * 32767), true); return b; }
function stepWav(rate, regions, hz) { const per = Math.floor(rate / 2), n = per * regions.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * regions[Math.floor(i / per)] * 32767), true); return b; }
class Level extends Phaser.Scene {
  constructor() { super('Level'); }
  create() {
    if (window.levelMode === 'naive') this.sound.add('tone', { loop: true }).play();
    else if (window.levelMode === 'reuse') { const m = this.sound.get('tone') || this.sound.add('tone', { loop: true }); if (!m.isPlaying) m.play(); }
  }
}
window.game = new Phaser.Game({ type: Phaser.CANVAS, width: 200, height: 100, parent: document.body, scene: [Level] });
game.events.once('ready', () => { window.ready = true; });
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/phaser.js') { res.setHeader('content-type', 'text/javascript'); res.end(phaserJs); }
  else if (req.url === '/beeps-sprite.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(convertedSprite)); }
  else if (req.url === '/tones.wav') { res.setHeader('content-type', 'audio/wav'); res.end(spriteBytes); }
  else { res.setHeader('content-type', 'text/html'); res.end(pageHtml); }
});
let origin, browser;
const pages = new Set();
const guard = setTimeout(() => { console.error('FAILED: native audio probe deadline'); browser?.close(); server.close(); }, 120000);
guard.unref();
let failed = false;
const ok = (name, detail) => { evidence.checks.push({name, detail}); console.log(`ok   ${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail)}`); };

async function closePage(page) {
  if (page.isClosed()) return;
  const state = await page.evaluate(async () => {
    if (!window.game) return {booted: false};
    const g = game, ctx = g.sound.context;
    for (const scene of g.scene.scenes) scene.tweens?.killAll();
    g.sound.stopAll(); g.sound.removeAll();
    if (window.audioTap) { g.sound.masterVolumeNode.disconnect(audioTap); audioTap.disconnect(); window.audioTap = null; }
    const out = {sounds: g.sound.sounds.length, tapCount: window.audioTap ? 1 : 0};
    // The intentional destroyed-sound tween error can interrupt RAF scheduling. A public step drains pending destroy.
    g.destroy(true); g.step(performance.now(), 0);
    const deadline = performance.now() + 4000;
    while ((ctx.state !== 'closed' || document.querySelector('canvas')) && performance.now() < deadline) await new Promise(done => setTimeout(done, 5));
    out.contextState = ctx.state; out.canvases = document.querySelectorAll('canvas').length;
    return out;
  });
  evidence.cleanup.pages.push(state);
  assert.equal(state.sounds, 0); assert.equal(state.tapCount, 0); assert.equal(state.contextState, 'closed'); assert.equal(state.canvases, 0);
  await page.close(); pages.delete(page);
}

async function open() {
  const page = await browser.newPage();
  pages.add(page);
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.goto(origin);
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(() => {
    window.audioFor = sec => new Promise((done, reject) => {
      const ctx = game.sound.context, t0 = ctx.currentTime, deadline = performance.now() + Math.max(2000, sec * 3000);
      const poll = () => { if (performance.now() > deadline) { reject(new Error('audio clock deadline')); return; } if (ctx.currentTime - t0 >= sec) done(); else setTimeout(poll, 5); };
      poll();
    });
    window.rafs = n => new Promise(done => { let i = 0; const tick = () => (++i >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
    window.decode = async list => { const s = game.sound, done = new Promise(res => s.once('decodedall', res)); s.decodeAudio(list); await done; };
    window.tap = () => {
      if (window.audioTap) throw new Error('one analysis tap per page');
      const ctx = game.sound.context, a = ctx.createAnalyser(); a.fftSize = 2048; game.sound.masterVolumeNode.connect(a);
      window.audioTap = a;
      window.peak = () => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return +Math.max(...d.map(Math.abs)).toFixed(3); };
    };
  });
  return {page, problems};
}

try {
  admitFixture();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  evidence.cleanup.browserCreated = true;
  evidence.identities.browser = browser.version(); evidence.identities.phaser = '4.2.1';
  // 0. Sticky activation: under Playwright a first play() resumes the context while Phaser still says locked.
  {
    const {page} = await open();
    const r = await page.evaluate(async () => {
      await decode([{key: 'tone', data: wav(1, 440, 22050)}]); const s = game.sound, before = s.context.state;
      s.play('tone', {volume: 0.1}); await rafs(20);
      return {before, after: s.context.state, locked: s.locked};
    });
    assert.deepEqual([r.before, r.after, r.locked], ['suspended', 'running', true]);
    ok('page.evaluate grants activation: play() runs the context while sound.locked stays true', r);
    await closePage(page);
  }

  const {page, problems} = await open();
  await page.mouse.click(50, 50);
  await page.waitForFunction(() => game.sound.context.state === 'running' && game.sound.locked === false);
  await page.evaluate(async () => {
    await decode([{key: 'tone', data: wav(1, 440, 22050)}, {key: 'blip', data: wav(0.3, 880, 22050)}, {key: 'sfx', data: wav(1, 660, 22050)}, {key: 'steps', data: stepWav(22050, [0.2, 0.5, 0.9], 440)}]);
    game.cache.json.add('sfx', {spritemap: {a: {start: 0, end: 0.2}, b: {start: 0.2, end: 0.5, loop: true}}});
    tap();
  });

  // 1. Config persistence and the volume getter.
  const cfg = await page.evaluate(async () => {
    const s = game.sound, r = {}, a = s.add('tone');
    a.volume = 0.3; r.immediate = a.volume; await audioFor(0.05); r.settled = +a.volume.toFixed(4);
    a.play({volume: 0.2}); a.stop(); a.play(); await audioFor(0.05); r.volumeAfterPlainPlay = +a.volume.toFixed(4); r.configVolume = a.config.volume;
    a.destroy();
    const m = s.add('tone'); m.addMarker({name: 'hit', start: 0.1, duration: 0.2});
    m.play('hit', {volume: 0.5}); m.stop(); m.play('hit'); await audioFor(0.05);
    r.markerVolumeAfterPlainPlay = +m.volume.toFixed(4); r.markerConfigVolume = m.markers.hit.config.volume;
    r.duplicateMarker = m.addMarker({name: 'hit'}); m.removeMarker('hit'); r.removedMarker = m.markers.hit; r.readded = m.addMarker({name: 'hit'});
    m.destroy(); return r;
  });
  assert.equal(cfg.immediate, 1, 'the volume getter still reads the old gain right after the setter');
  assert.equal(cfg.settled, 0.3); assert.equal(cfg.volumeAfterPlainPlay, 0.2); assert.equal(cfg.configVolume, 0.2);
  assert.equal(cfg.markerVolumeAfterPlainPlay, 0.5); assert.equal(cfg.markerConfigVolume, 0.5);
  assert.equal(cfg.duplicateMarker, false); assert.equal(cfg.removedMarker, null); assert.equal(cfg.readded, true);
  ok('per-play config persists; volume getter lags one render quantum; marker rules', cfg);

  // 2. Fire-and-forget: stopAll leaves them in the manager, completion removes them.
  const ff = await page.evaluate(async () => {
    const s = game.sound, r = {}; s.removeAll(); game.step(performance.now(), 16);
    for (let i = 0; i < 5; i++) s.play('tone');
    s.stopAll(); game.step(performance.now(), 16);
    r.afterStopAll = {sounds: s.sounds.length, playing: s.getAllPlaying().length, completeListeners: s.sounds[0].listenerCount('complete')};
    s.removeAll(); game.step(performance.now(), 16); r.afterRemoveAll = s.sounds.length;
    s.play('blip'); const t0 = performance.now();
    while (s.sounds.length && performance.now() - t0 < 4000) { await rafs(1); }
    r.afterComplete = s.sounds.length; return r;
  });
  assert.deepEqual(ff.afterStopAll, {sounds: 5, playing: 0, completeListeners: 1});
  assert.equal(ff.afterRemoveAll, 0); assert.equal(ff.afterComplete, 0);
  ok('stopAll leaves fire-and-forget sounds registered; completion and removeAll clean them', ff);

  // 3. Markers, audio sprites, restart-versus-overlap.
  const sprite = await page.evaluate(async () => {
    const s = game.sound, r = {}, sp = s.addAudioSprite('sfx');
    r.markers = Object.fromEntries(Object.entries(sp.markers).map(([k, v]) => [k, {start: v.start, duration: +v.duration.toFixed(3), loop: v.config.loop}]));
    let completes = 0, looped = 0; sp.on('complete', () => completes++); sp.on('looped', () => looped++);
    sp.play('a'); await new Promise(res => sp.once('complete', res)); r.aCompleted = completes; r.durationOfA = sp.duration;
    sp.play('b'); await audioFor(1.0); r.bLooped = looped; r.bPlaying = sp.isPlaying; sp.stop(); sp.destroy();
    const one = s.add('tone'); one.play(); await audioFor(0.03); one.play(); r.retainedTwicePlaying = s.getAllPlaying().length; one.destroy();
    s.removeAll(); game.step(performance.now(), 16);
    s.play('tone'); s.play('tone'); s.play('tone'); r.fireAndForgetOverlap = s.getAllPlaying().length; s.stopAll(); s.removeAll();
    for (let i = 0; i < 300; i++) s.play('tone', {volume: 0.01});
    r.threeHundredVoices = s.getAllPlaying().length; s.stopAll(); s.removeAll();
    const q = s.add('tone'); q.play({rate: 2}); await audioFor(0.2); r.seekAtRate2 = +q.seek.toFixed(1); q.destroy();
    return r;
  });
  assert.deepEqual(sprite.markers, {a: {start: 0, duration: 0.2, loop: false}, b: {start: 0.2, duration: 0.3, loop: true}});
  assert.equal(sprite.aCompleted, 1); assert.equal(sprite.durationOfA, 0.2);
  assert.ok(sprite.bLooped >= 2 && sprite.bPlaying, 'a looping marker loops');
  assert.equal(sprite.retainedTwicePlaying, 1, 'play() on a retained instance restarts it'); assert.equal(sprite.fireAndForgetOverlap, 3);
  assert.equal(sprite.threeHundredVoices, 300, 'WebAudio has no voice cap');
  ok('audio sprite markers, marker loops, restart versus overlap, no voice cap, seek follows rate', sprite);

  // 3b. Markers from beeps section times: a 1.5 s file whose three half-second regions have peaks 0.2, 0.5 and 0.9 stands in for a song.
  const rate = 22050, sidecar = {sampleRate: rate, sections: ['s1', 's2', 's3'].map((name, i) => ({name, start: i / 2, end: (i + 1) / 2, startFrame: i * rate / 2, endFrame: (i + 1) * rate / 2}))};
  const regions = await page.evaluate(async ({plain, looping}) => {
    const s = game.sound, ctx = s.context, r = {added: []};
    const run = async (name, markers, seconds) => {
      const snd = s.add('steps'); r.added.push(...markers.map(m => snd.addMarker(m)));
      let looped = 0; snd.on('looped', () => looped++);
      const t0 = ctx.currentTime, peaks = []; let done = null; snd.once('complete', () => { done = ctx.currentTime - t0; });
      snd.play(name);
      while (ctx.currentTime - t0 < seconds && done === null) { await audioFor(0.04); if (ctx.currentTime - t0 > 0.1 && ctx.currentTime - t0 < 0.42) peaks.push(peak()); }
      const out = {low: Math.min(...peaks), high: Math.max(...peaks), completedAfter: done === null ? null : +done.toFixed(3), looped, duration: snd.duration};
      snd.stop(); snd.destroy(); return out;
    };
    r.s1 = await run('s1', plain, 1.0); r.s2 = await run('s2', plain, 1.0); r.s3 = await run('s3', looping, 1.3); return r;
  }, {plain: markersFromSections(sidecar), looping: markersFromSections(sidecar, {loopSections: ['s3']})});
  assert.ok(regions.added.every(Boolean), 'every converter marker was accepted by addMarker');
  // The analyser's absolute level is not the file's amplitude, so compare the regions with each other: 0.2 : 0.5 : 0.9, and steady inside a marker.
  for (const [name, share] of [['s1', 0.2 / 0.9], ['s2', 0.5 / 0.9]]) {
    assert.ok(Math.abs(regions[name].high / regions.s3.high - share) < 0.05, name + ' sits at ' + share.toFixed(2) + ' of the loudest region');
    assert.ok(regions[name].low > 0.9 * regions[name].high, name + ' stays inside its own region');
  }
  assert.ok(regions.s3.low > 0.9 * regions.s3.high, 's3 stays inside its own region'); assert.equal(regions.s2.duration, 0.5);
  assert.ok(regions.s2.completedAfter > 0.46 && regions.s2.completedAfter < 0.57, 'marker s2 completes after its half second on the audio clock');
  assert.ok(regions.s1.completedAfter > 0.46 && regions.s1.completedAfter < 0.57); assert.ok(regions.s3.looped >= 2 && regions.s3.completedAfter === null, 'a looped section loops its own region');
  ok('markersFromSections: a section marker plays only its region on the audio clock, and a looped one repeats it', regions);

  // 3c. Released PCM sprite: actual loader, independent signal windows, completion and native repetition.
  const packed = await page.evaluate(async () => {
    const scene = game.scene.getScene('Level'), s = game.sound, ctx = s.context;
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('audioSprite load deadline')), 10000);
      scene.load.once('complete', () => { clearTimeout(timeout); done(); });
      scene.load.audioSprite('beeps-packed', '/beeps-sprite.json'); scene.load.start();
    });
    if (!game.cache.audio.exists('beeps-packed') || !game.cache.json.exists('beeps-packed')) throw new Error('native audioSprite cache admission');
    const decoded = game.cache.audio.get('beeps-packed');
    const out = {renderer: game.renderer.type, sampleRate: ctx.sampleRate, decoded: {frames: decoded.length, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels}, tapCount: window.audioTap ? 1 : 0, entries: {}};
    const windowAt = () => {
      const data = new Float32Array(audioTap.fftSize); audioTap.getFloatTimeDomainData(data);
      const crossings = [];
      for (let i = 0; i < data.length - 1; i++) if (data[i] <= 0 && data[i + 1] > 0) crossings.push(i + data[i] / (data[i] - data[i + 1]));
      return {peak: Math.max(...data.map(Math.abs)), hz: crossings.length > 1 ? (crossings.length - 1) * ctx.sampleRate / (crossings.at(-1) - crossings[0]) : 0, samples: Array.from(data)};
    };
    for (const id of ['low', 'mid', 'high']) {
      const snd = s.addAudioSprite('beeps-packed');
      const t0 = ctx.currentTime, events = [], windows = []; let complete = null, loops = 0;
      for (const name of ['play', 'looped', 'complete', 'stop']) snd.on(name, () => { events.push({name, time: ctx.currentTime - t0}); if (name === 'complete') complete = ctx.currentTime - t0; if (name === 'looped') loops++; });
      try {
        if (!snd.play(id)) throw new Error('native sprite entry refused: ' + id);
        const observation = id === 'high' ? 1.3 : 0.8;
        while (ctx.currentTime - t0 < observation && complete === null) {
          await audioFor(0.04);
          const elapsed = ctx.currentTime - t0;
          // Avoid start/end quanta; high includes windows from the second and third repetitions.
          if (elapsed > 0.1 && (id === 'high' || elapsed < 0.42)) windows.push({time: elapsed, ...windowAt()});
        }
        const marker = snd.markers[id];
        const entry = {duration: snd.duration, marker: {start: marker.start, duration: marker.duration, loop: marker.config.loop}, complete, loops, playingBeforeStop: snd.isPlaying, windows, events};
        snd.stop(); entry.playingAfterStop = snd.isPlaying;
        const eventCount = events.length; await audioFor(0.08); entry.eventsAfterStop = events.length - eventCount;
        out.entries[id] = entry;
      } finally { snd.stop(); snd.destroy(); }
    }
    s.removeByKey('beeps-packed'); game.cache.audio.remove('beeps-packed'); game.cache.json.remove('beeps-packed');
    out.ownedCacheRemoved = !game.cache.audio.exists('beeps-packed') && !game.cache.json.exists('beeps-packed');
    return out;
  });
  evidence.nativeSprite = packed;
  assert.equal(packed.tapCount, 1, 'one owned analysis tap');
  assert.equal(packed.decoded.channels, 1);
  assert.ok(Math.abs(packed.decoded.frames - 1.7 * packed.decoded.sampleRate) <= 1, 'decoded PCM frame length');
  for (const [id, hz] of [['low', 220], ['mid', 440], ['high', 880]]) {
    const entry = packed.entries[id];
    assert.ok(entry.windows.length >= 4, id + ' has bounded native signal windows');
    assert.ok(entry.windows.every(w => Math.abs(w.hz - hz) < 3), id + ' sprite-range frequency witness');
    const peaks = entry.windows.map(w => w.peak);
    assert.ok(Math.min(...peaks) > 0.9 * Math.max(...peaks), id + ' stays inside its own PCM region');
    assert.equal(entry.playingAfterStop, false); assert.equal(entry.eventsAfterStop, 0, id + ' stops its owned playback');
  }
  for (const [id, ratio] of [['low', 0.2 / 0.9], ['mid', 0.5 / 0.9]]) {
    const peak = id => Math.max(...packed.entries[id].windows.map(w => w.peak));
    assert.ok(Math.abs(peak(id) / peak('high') - ratio) < 0.05, id + ' sprite-range level witness');
    assert.ok(packed.entries[id].complete > 0.46 && packed.entries[id].complete < 0.57, id + ' completes after its declared half second');
  }
  assert.ok(packed.entries.high.loops >= 2 && packed.entries.high.complete === null && packed.entries.high.playingBeforeStop, 'sprite-loop native repetition witness');
  assert.ok(packed.entries.high.windows.some(w => w.time > 1.1), 'third repetition retained');
  assert.equal(packed.ownedCacheRemoved, true);
  ok('spritemapFromMap: released PCM audioSprite regions, completion and looping', {decoded: packed.decoded, entries: Object.fromEntries(Object.entries(packed.entries).map(([id, r]) => [id, {complete: r.complete, loops: r.loops, hz: r.windows.map(w => +w.hz.toFixed(2)), peaks: r.windows.map(w => +w.peak.toFixed(3))}]))});

  // 4. Loops need frames: with the Phaser loop asleep the third repetition is never scheduled.
  const loop = async framesRun => page.evaluate(async framesRun => {
    const s = game.sound, r = {peaks: [], looped: 0}; if (framesRun) game.loop.wake(); else game.loop.sleep();
    const t = s.add('blip', {loop: true}); t.on('looped', () => r.looped++); t.play();
    for (let i = 0; i < 12; i++) { await audioFor(0.1); r.peaks.push(peak()); }
    r.isPlaying = t.isPlaying; t.stop(); t.destroy(); game.loop.wake(); return r;
  }, framesRun);
  const running = await loop(true), asleep = await loop(false);
  assert.ok(running.peaks.every(p => p > 0.3) && running.looped >= 3 && running.isPlaying);
  assert.ok(asleep.peaks.slice(0, 5).every(p => p > 0.3), 'two repetitions play without frames');
  assert.ok(asleep.peaks.slice(7).every(p => p === 0) && asleep.looped === 0 && asleep.isPlaying, 'then silence while isPlaying stays true');
  ok('a 0.3 s loop falls silent after two repetitions when no frame runs', {running, asleep});

  // 5. Scene restarts stack naive music; reuse keeps one.
  const restart = await page.evaluate(async () => {
    const r = {}; game.scene.start('Level'); await rafs(2);
    r.sameManager = game.scene.getScene('Level').sound === game.sound;
    const count = async mode => {
      game.sound.removeAll(); window.levelMode = mode;
      for (let i = 0; i < 4; i++) { game.scene.getScene('Level').scene.restart(); await rafs(3); }
      const out = {sounds: game.sound.sounds.length, playing: game.sound.getAllPlaying().length}; game.sound.removeAll(); return out;
    };
    r.naive = await count('naive'); r.reuse = await count('reuse'); return r;
  });
  assert.equal(restart.sameManager, true); assert.deepEqual(restart.naive, {sounds: 4, playing: 4}); assert.deepEqual(restart.reuse, {sounds: 1, playing: 1});
  ok('four scene starts stack four loops unless create() reuses the sound', restart);

  // 6. A tween on volume outlives a destroyed sound and throws.
  const before = problems.length;
  await page.evaluate(async () => {
    const sc = game.scene.getScene('Level'), snd = game.sound.add('tone', {loop: true}); snd.play();
    sc.tweens.add({targets: snd, volume: 0, duration: 1000 }); await rafs(5); snd.destroy(); await rafs(10);
  });
  const tweenProblems = problems.slice(before);
  assert.ok(tweenProblems.some(p => /Cannot set properties of null \(setting 'volume'\)/.test(p)));
  ok('destroying a sound under a volume tween throws on the next tween update', tweenProblems);

  const unexpected = problems.filter(p => !tweenProblems.includes(p));
  assert.deepEqual(unexpected.filter(p => !/Marker .* missing|already exists/.test(p)), [], 'no other console errors');
  console.log('all checks passed');
} catch (error) {
  failed = true;
  evidence.failure = {name: error.name, message: error.message, stack: error.stack};
  console.error('FAILED:', error.message);
} finally {
  clearTimeout(guard);
  for (const page of pages) {
    try { await closePage(page); } catch (error) { failed = true; (evidence.cleanup.errors ??= []).push(error.message); }
  }
  if (browser) await browser.close();
  evidence.cleanup.browserClosed = browser ? !browser.isConnected() : true;
  server.closeAllConnections();
  if (server.listening) await new Promise(done => server.close(done));
  evidence.cleanup.serverClosed = !server.listening;
  evidence.passed = !failed;
  if (evidenceDir) writeFileSync(resolve(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('cleanup: ' + JSON.stringify(evidence.cleanup));
}
process.exit(failed ? 1 : 0);
