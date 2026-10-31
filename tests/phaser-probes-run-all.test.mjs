// The probe runner stays honest: every .mjs file in the probes folder is either a listed probe or a listed non-probe (a new probe cannot be forgotten by
// the one-command lane), a probe the chosen lane cannot run is skipped and never counted as passed, and the exit code follows the failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANES, NON_PROBES, PROBES, describeExit, parseArgs, plan, summarize } from '../examples/web/phaser-probes/run-all-lib.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'web', 'phaser-probes');
const files = readdirSync(dir).filter(f => f.endsWith('.mjs'));
const options = over => ({ ...parseArgs(['/host']), ...over });

test('every .mjs file in the probes folder is a listed probe or a listed non-probe, and every listed file exists', () => {
  const listed = [...PROBES.map(p => p.file), ...NON_PROBES];
  assert.deepEqual(files.filter(f => !listed.includes(f)), [], 'add the new file to PROBES (with its lane) or to NON_PROBES in run-all-lib.mjs');
  assert.deepEqual(listed.filter(f => !files.includes(f)), [], 'a listed file no longer exists');
  assert.equal(new Set(listed).size, listed.length, 'a file is listed twice');
});

test('every probe has a known lane and the errata check runs first', () => {
  for (const p of PROBES) assert.ok(LANES.includes(p.lane), `${p.file}: ${p.lane}`);
  assert.equal(PROBES[0].file, 'phaser-docs-errata.mjs');
});

test('without --hardware a hardware-only probe is skipped with a reason, and a manual probe is never run', () => {
  const steps = plan(options({}));
  const by = file => steps.find(s => s.file === file);
  assert.equal(by('scroll-mask.mjs').action, 'skip');
  assert.match(by('scroll-mask.mjs').reason, /--hardware/);
  assert.equal(by('audio-decode.mjs').action, 'skip');
  assert.equal(by('phaser-docs-errata.mjs').action, 'run');
  assert.equal(by('phaser-native-control-observation.mjs').action, 'run', 'Canvas native input needs no hardware lane');
});

test('--hardware runs the hardware-only probes and points the rendering and worlds probes at the platform backend; software probes keep a clean environment', () => {
  const steps = plan(options({ hardware: true }), { platform: 'win32', env: { PATH: 'x' } });
  const by = file => steps.find(s => s.file === file);
  assert.equal(by('source-pixels.mjs').action, 'run');
  assert.deepEqual([by('phaser-rendering-filters.mjs').env.PROBE_GL, by('phaser-rendering-filters.mjs').env.ANGLE], ['hardware', 'd3d11']);
  assert.equal(by('phaser-worlds-lights.mjs').env.ANGLE, 'd3d11');
  assert.equal(by('phaser-physics-arcade.mjs').env.PROBE_GL, undefined);
  assert.equal(by('audio-visibility.mjs').action, 'skip');
  const software = plan(options({}), { platform: 'win32', env: {} });
  assert.equal(software.find(s => s.file === 'phaser-rendering-filters.mjs').env.PROBE_GL, undefined);
});

test('--only selects by prefix, --channel reaches every child, an empty selection is an error', () => {
  assert.deepEqual(plan(options({ only: 'phaser-physics' })).map(s => s.file), ['phaser-physics-arcade.mjs', 'phaser-physics-matter.mjs', 'phaser-physics-paths.mjs', 'phaser-physics-tilemap.mjs']);
  assert.ok(plan(options({ channel: 'chrome' })).filter(s => s.action === 'run').every(s => s.env.CHROME_CHANNEL === 'chrome'));
  assert.throws(() => plan(options({ only: 'nothing-like-this' })), /matches no probe/);
});

test('the tally never counts a skipped probe as passed and the exit code follows the failures', () => {
  assert.deepEqual(summarize([{ status: 'pass' }, { status: 'skipped' }, { status: 'skipped' }]), { passed: 1, failed: 0, skipped: 2, exit: 0 });
  assert.equal(summarize([{ status: 'pass' }, { status: 'fail' }]).exit, 1);
  assert.deepEqual(describeExit(0, false), { status: 'pass', note: '' });
  assert.equal(describeExit(null, true).status, 'fail');
  assert.match(describeExit(2, false).note, /wrong Phaser version/);
  assert.equal(describeExit(1, false).status, 'fail');
});

test('argument parsing', () => {
  assert.deepEqual(parseArgs(['/h', '--hardware', '--only', 'phaser-input', '--timeout', '30', '--channel', 'chrome']), { host: '/h', hardware: true, only: 'phaser-input', timeoutSec: 30, channel: 'chrome', list: false });
  assert.equal(parseArgs(['--list']).list, true);
  for (const bad of [[], ['/h', '--timeout', '0'], ['/h', '--timeout'], ['/h', '--only'], ['/h', '--nope'], ['/a', '/b']]) assert.throws(() => parseArgs(bad), /usage|--timeout|--only|unknown/, bad.join(' '));
});
