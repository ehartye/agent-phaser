// Check: node tests/fixtures/audio-sprite/regenerate.mjs /path/to/agent-beeps
// Write intentionally: append --write. Requires Node 24+ and the released producer's installed dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = dirname(fileURLToPath(import.meta.url));
const producer = resolve(process.argv[2] || '.');
const revision = '377a95eeabbac7da2609dc4aa0862bb9b1bffeae';
const runtime = '72f9e6f43d92d24a4c61e2a18762186ca5cd8a85';
const rate = 48000, frames = 24000;
const definitions = [
  { id: 'low', hz: 220, amplitude: 0.2, frames, loop: false },
  { id: 'mid', hz: 440, amplitude: 0.5, frames, loop: false },
  { id: 'high', hz: 880, amplitude: 0.9, frames, loop: true },
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function run(exe, args, cwd) {
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${exe} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
assert.equal(run('git', ['rev-parse', 'HEAD'], producer), revision, 'use the exact released producer source');
assert.equal(run('git', ['rev-parse', 'v0.36.0^{commit}'], producer), revision, 'authenticate the local release tag');
assert.equal(run('git', ['ls-remote', 'origin', 'refs/tags/v0.36.0'], producer).split('\t')[0], revision, 'authenticate the actual remote release');
assert.equal(run('git', ['status', '--porcelain'], producer), '', 'producer checkout must be clean');
assert.equal(JSON.parse(readFileSync(join(producer, 'package.json'))).version, '0.36.0');
function wav({ hz, amplitude, frames }) {
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * frame / rate) * amplitude * 32767), 44 + frame * 2);
  return bytes;
}
const scratch = mkdtempSync(join(tmpdir(), 'phaser-audio-sprite-'));
const bytes = new Map();
try {
  for (const entry of definitions) bytes.set(`${entry.id}.wav`, wav(entry));
  bytes.set('recipes.json', json({ tones: { kind: 'sprite', role: 'sfx', entries: definitions.map(({ id, loop }) => ({ id, source: `${id}.wav`, loop })) } }));
  bytes.set('project.json', json({ schema: 'beeps/project@1' }));
  bytes.set('beeps.build.json', json({ recipes: 'recipes.json', project: 'project.json', out: 'out', lock: 'audio.lock.json', workDir: 'work', target: 'wav-master', jobs: 1 }));
  for (const [file, content] of bytes) writeFileSync(join(scratch, file), content);
  const launcher = join(producer, 'scripts', 'beeps.mjs');
  const build = [launcher, 'build', '--config', join(scratch, 'beeps.build.json'), '--target', 'wav-master'];
  run(process.execPath, build, scratch);
  run(process.execPath, [...build, '--check'], scratch);
  run(process.execPath, [launcher, 'verify', '--lock', join(scratch, 'audio.lock.json'), '--out', join(scratch, 'out')], scratch);
  for (const file of ['tones.wav', 'tones.sprite.json']) bytes.set(file, readFileSync(join(scratch, 'out', file)));
  const map = JSON.parse(bytes.get('tones.sprite.json'));
  assert.equal(map.audio.sha256, digest(bytes.get('tones.wav')));
  bytes.set('provenance.json', json({
    schema: 'phaser/pcm-sprite-fixture@1',
    producer: { repository: 'https://github.com/ehartye/agent-beeps', version: '0.36.0', tag: 'v0.36.0', revision, runtime },
    mapSchema: 'beeps/audio-sprite@1', sampleRate: rate, channels: 1, gapFrames: 4800, frames: 81600,
    formula: 'round(sin(2 * PI * hz * frame / 48000) * amplitude * 32767)', definitions,
    files: Object.fromEntries([...bytes].map(([file, content]) => [file, { bytes: content.length, sha256: digest(content) }])),
  }));
  for (const [file, content] of bytes) {
    if (process.argv.includes('--write')) writeFileSync(join(fixture, file), content);
    else assert.deepEqual(readFileSync(join(fixture, file)), content, `${file} reproduces exactly`);
  }
  console.log(JSON.stringify({ producer: revision, files: [...bytes.keys()], wav: digest(bytes.get('tones.wav')), map: digest(bytes.get('tones.sprite.json')) }));
} finally {
  const target = resolve(scratch), base = resolve(tmpdir());
  assert.ok(target.startsWith(base + sep) && target.split(sep).at(-1).startsWith('phaser-audio-sprite-'));
  assert.equal(lstatSync(target).isSymbolicLink(), false);
  rmSync(target, { recursive: true, force: true });
  assert.equal(existsSync(target), false, 'owned fixture workspace removed');
}
