// Pure conversion of the standalone beeps/audio-sprite@1 map released in agent-beeps 0.36.0.
// Frame offsets are authoritative; this helper validates metadata, not external WAV bytes.
const schema = 'beeps/audio-sprite@1';
const maxInputBytes = 16 * 1024 * 1024, maxWavBytes = 64 * 1024 * 1024;
const fail = message => { throw new Error(`audio sprite: ${message}`); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function object(value, keys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    fail(`${name} has malformed or unknown fields`);
  }
  return value;
}

/** Return native Phaser audio-sprite JSON from an authenticated producer map and explicit resource URLs. */
export function spritemapFromMap(value, urls) {
  const map = object(value, ['schema', 'sampleRate', 'channels', 'frames', 'gapFrames', 'audio', 'entries'], 'map');
  if (map.schema !== schema) fail('unsupported schema');
  if (!integer(map.sampleRate, 1, 192000)) fail('sampleRate is outside the supported integer range');
  if (map.channels !== 1 && map.channels !== 2) fail('channels must be 1 or 2');
  const maxFrames = Math.floor((maxWavBytes - 44) / (2 * map.channels));
  if (!integer(map.frames, 1, maxFrames)) fail('frames exceed the packed WAV size limit');
  if (!integer(map.gapFrames, 1, 19200) || map.gapFrames !== Math.ceil(map.sampleRate / 10)) {
    fail('gapFrames must equal ceil(sampleRate / 10)');
  }
  const audio = object(map.audio, ['file', 'sha256', 'encoding'], 'audio');
  if (typeof audio.file !== 'string' || !/^[^\\/:*?"<>|\x00-\x1f]+\.wav$/i.test(audio.file)
    || audio.file.includes('..') || /[. ]$/.test(audio.file) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(audio.file)) {
    fail('audio.file must be a portable same-directory WAV basename');
  }
  if (audio.encoding !== 'pcm_s16le' || !hash(audio.sha256)) fail('audio requires pcm_s16le encoding and a lowercase SHA-256');
  if (!Array.isArray(map.entries) || map.entries.length < 1 || map.entries.length > 128) fail('entries must contain 1–128 items');
  const seen = new Set();
  let next = 0;
  const entries = [];
  for (const value of map.entries) {
    const entry = object(value, ['id', 'startFrame', 'endFrame', 'loop', 'sourceSha256', 'sourceFrames'], 'entry');
    if (typeof entry.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(entry.id)
      || ['constructor', 'prototype', '__proto__'].includes(entry.id)) fail('entry id is invalid or reserved');
    if (seen.has(entry.id)) fail(`duplicate entry id "${entry.id}"`);
    seen.add(entry.id);
    if (!integer(entry.startFrame, 0, maxFrames) || !integer(entry.endFrame, 1, maxFrames)
      || !integer(entry.sourceFrames, 1, Math.floor((maxInputBytes - 44) / (2 * map.channels)))
      || entry.startFrame !== next || entry.endFrame - entry.startFrame !== entry.sourceFrames) {
      fail(`entry "${entry.id}" has invalid frame boundaries or source size`);
    }
    if (typeof entry.loop !== 'boolean' || !hash(entry.sourceSha256)) fail(`entry "${entry.id}" requires a boolean loop and lowercase source SHA-256`);
    entries.push([entry.id, { start: entry.startFrame / map.sampleRate, end: entry.endFrame / map.sampleRate, loop: entry.loop }]);
    next = entry.endFrame + map.gapFrames;
  }
  if (next - map.gapFrames !== map.frames) fail('last entry end must equal frames');
  if (!Array.isArray(urls) || urls.length === 0 || [...urls].some(url => typeof url !== 'string' || url.trim().length === 0)) {
    fail('resources require a nonempty array of explicit URL strings');
  }
  return { resources: [...urls], spritemap: Object.fromEntries(entries) };
}
