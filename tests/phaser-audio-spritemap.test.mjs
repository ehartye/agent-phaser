import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spritemapFromMap } from '../skills/phaser-audio/scripts/assets/beeps-spritemap.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/audio-sprite/${name}`, import.meta.url));
const map = JSON.parse(fixture('tones.sprite.json'));
const provenance = JSON.parse(fixture('provenance.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const urls = ['/audio/tones.wav', 'https://assets.example/tones.wav'];

test('released frame ranges convert exactly with explicit resources and loop flags', () => {
  assert.deepEqual(spritemapFromMap(map, urls), {
    resources: urls,
    spritemap: {
      low: { start: 0, end: 0.5, loop: false },
      mid: { start: 0.6, end: 1.1, loop: false },
      high: { start: 1.2, end: 1.7, loop: true },
    },
  });
  const result = spritemapFromMap(map, urls);
  for (const entry of map.entries) {
    assert.equal(result.spritemap[entry.id].start, entry.startFrame / map.sampleRate);
    assert.equal(result.spritemap[entry.id].end, entry.endFrame / map.sampleRate);
    assert.equal(result.spritemap[entry.id].loop, entry.loop);
  }
});

test('conversion does not mutate or alias the map, entries or resource array', () => {
  const before = structuredClone(map), input = structuredClone(map), resources = [...urls];
  Object.freeze(input.audio); input.entries.forEach(Object.freeze); Object.freeze(input.entries); Object.freeze(input); Object.freeze(resources);
  const result = spritemapFromMap(input, resources);
  result.resources.push('another.wav'); result.spritemap.low.end = 99;
  assert.deepEqual(input, before);
  assert.deepEqual(resources, urls);
  assert.equal(spritemapFromMap(input, resources).spritemap.low.end, 0.5);
});

test('frame arithmetic follows integer positions at a non-divisible sample rate', () => {
  const alternate = structuredClone(map);
  alternate.sampleRate = 44101; alternate.gapFrames = 4411;
  alternate.entries.forEach((entry, index) => { entry.startFrame = index * (24000 + 4411); entry.endFrame = entry.startFrame + 24000; });
  alternate.frames = alternate.entries.at(-1).endFrame;
  const result = spritemapFromMap(alternate, ['explicit.wav']);
  assert.equal(result.spritemap.mid.start, 28411 / 44101);
  assert.equal(result.spritemap.high.end, 80822 / 44101);
});

test('malformed maps refuse the released schema, format, identity and integer-range boundaries', async t => {
  const mutations = [
    ['unknown schema', m => { m.schema = 'beeps/audio-sprite@2'; }],
    ['unknown field', m => { m.seconds = 1; }],
    ['missing field', m => { delete m.channels; }],
    ['string rate', m => { m.sampleRate = '48000'; }],
    ['nonfinite rate', m => { m.sampleRate = Infinity; }],
    ['fractional rate', m => { m.sampleRate = 48000.5; }],
    ['zero rate', m => { m.sampleRate = 0; }],
    ['rate limit', m => { m.sampleRate = 192001; }],
    ['channel limit', m => { m.channels = 3; }],
    ['empty frames', m => { m.frames = 0; }],
    ['unsafe frames', m => { m.frames = Number.MAX_SAFE_INTEGER + 1; }],
    ['packed size limit', m => { m.frames = Math.floor((64 * 1024 * 1024 - 44) / 2) + 1; }],
    ['incorrect gap', m => { m.gapFrames--; }],
    ['unknown audio field', m => { m.audio.url = 'inferred.wav'; }],
    ['lossy encoding', m => { m.audio.encoding = 'opus'; }],
    ['malformed audio hash', m => { m.audio.sha256 = 'A'.repeat(64); }],
    ['nested audio path', m => { m.audio.file = 'nested/tones.wav'; }],
    ['backslash audio path', m => { m.audio.file = 'nested\\tones.wav'; }],
    ['traversal audio path', m => { m.audio.file = '../tones.wav'; }],
    ['reserved audio file', m => { m.audio.file = 'con.wav'; }],
    ['unsupported audio file', m => { m.audio.file = 'tones.mp3'; }],
    ['empty entries', m => { m.entries = []; }],
    ['too many entries', m => { m.entries = Array(129).fill(m.entries[0]); }],
    ['sparse entries', m => { delete m.entries[1]; }],
    ['duplicate entry', m => { m.entries[1].id = m.entries[0].id; }],
    ['unsafe entry ID', m => { m.entries[0].id = '__proto__'; }],
    ['reserved constructor', m => { m.entries[0].id = 'constructor'; }],
    ['reserved prototype', m => { m.entries[0].id = 'prototype'; }],
    ['overlong ID', m => { m.entries[0].id = 'a'.repeat(65); }],
    ['numeric ID', m => { m.entries[0].id = 1; }],
    ['unknown entry field', m => { m.entries[0].start = 0; }],
    ['negative start', m => { m.entries[0].startFrame = -1; }],
    ['fractional start', m => { m.entries[1].startFrame += 0.5; }],
    ['overlap', m => { m.entries[1].startFrame--; }],
    ['out of order', m => { m.entries.reverse(); }],
    ['leading gap', m => { m.entries[0].startFrame = 1; }],
    ['source length mismatch', m => { m.entries[0].sourceFrames--; }],
    ['empty source', m => { m.entries[0].sourceFrames = 0; }],
    ['input size limit', m => { m.entries[0].sourceFrames = Math.floor((16 * 1024 * 1024 - 44) / 2) + 1; }],
    ['nonfinite end', m => { m.entries[2].endFrame = NaN; }],
    ['last end mismatch', m => { m.frames++; }],
    ['missing loop', m => { delete m.entries[2].loop; }],
    ['coerced loop', m => { m.entries[2].loop = 'true'; }],
    ['malformed source hash', m => { m.entries[2].sourceSha256 = 'not-a-hash'; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const changed = structuredClone(map); mutate(changed);
    assert.throws(() => spritemapFromMap(changed, urls), /audio sprite:/);
  });
  for (const value of [undefined, null, [], 'map']) assert.throws(() => spritemapFromMap(value, urls), /audio sprite:/);
});

test('missing, empty or non-string explicit resources refuse without URL inference', () => {
  for (const resources of [undefined, null, 'tones.wav', [], [''], ['   '], [1], [null], ['tones.wav', false], Array(1)]) {
    assert.throws(() => spritemapFromMap(map, resources), /resources require/);
  }
  assert.deepEqual(spritemapFromMap(map, ['chosen.wav']).resources, ['chosen.wav']);
});

test('committed released-producer fixture has exact PCM sources, packed ranges and silent gaps', () => {
  assert.equal(provenance.producer.version, '0.36.0');
  assert.equal(provenance.producer.revision, '377a95eeabbac7da2609dc4aa0862bb9b1bffeae');
  assert.equal(provenance.mapSchema, 'beeps/audio-sprite@1');
  for (const [name, identity] of Object.entries(provenance.files)) {
    const bytes = fixture(name);
    assert.equal(bytes.length, identity.bytes, name);
    assert.equal(sha256(bytes), identity.sha256, name);
  }
  const packed = fixture('tones.wav');
  assert.equal(sha256(packed), map.audio.sha256);
  assert.deepEqual([packed.toString('ascii', 0, 4), packed.toString('ascii', 8, 12), packed.readUInt16LE(20), packed.readUInt16LE(22), packed.readUInt32LE(24), packed.readUInt16LE(34)], ['RIFF', 'WAVE', 1, 1, 48000, 16]);
  assert.equal(packed.length, 44 + map.frames * 2);
  for (const [index, definition] of provenance.definitions.entries()) {
    const entry = map.entries[index], source = fixture(`${definition.id}.wav`);
    assert.equal(sha256(source), entry.sourceSha256);
    assert.equal(entry.sourceFrames, definition.frames);
    assert.deepEqual(packed.subarray(44 + entry.startFrame * 2, 44 + entry.endFrame * 2), source.subarray(44));
    for (let frame = 0; frame < definition.frames; frame++) {
      const expected = Math.round(Math.sin(2 * Math.PI * definition.hz * frame / 48000) * definition.amplitude * 32767) || 0;
      assert.equal(source.readInt16LE(44 + frame * 2), expected, `${definition.id} frame ${frame}`);
    }
    if (index < map.entries.length - 1) {
      assert.ok(packed.subarray(44 + entry.endFrame * 2, 44 + map.entries[index + 1].startFrame * 2).every(value => value === 0));
    }
  }
  const corrupted = Buffer.from(packed); corrupted[46] ^= 1;
  assert.notEqual(sha256(corrupted), map.audio.sha256, 'decodable changed WAV byte fails identity');
  const wrongRange = structuredClone(map); wrongRange.entries[1].startFrame++;
  assert.throws(() => spritemapFromMap(wrongRange, urls), /frame boundaries/);
});
