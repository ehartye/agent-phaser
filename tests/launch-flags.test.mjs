// One list of Chromium flags for a real GPU: gpuArgs() in examples/web/verify-checks.mjs. The probes that launch a GPU browser import it; the harness template is
// copied into games, so it inlines the same flags, and this test fails when the copy drifts or a launch site drops the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuArgs } from '../examples/web/verify-checks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('the harness template config carries every flag of gpuArgs()', () => {
  const config = read('examples/web/harness/playwright.config.mjs');
  const real = config.split('\n').find(line => /const args = software/.test(line));
  assert.ok(real, 'the config line that picks the launch arguments moved');
  const [angle, ...flags] = gpuArgs('win32');
  assert.equal(angle, '--use-angle=d3d11');
  assert.ok(real.includes('`--use-angle=${backend}`'), 'the harness picks the platform backend');
  for (const flag of flags) assert.ok(real.includes(`'${flag}'`), `the harness lost ${flag}`);
  assert.match(config, /gpuArgs\(\)/, 'the config should name gpuArgs() so a reader can find the source list');
});

test('every standalone probe that launches a GPU browser imports gpuArgs()', () => {
  for (const file of ['shot.mjs', 'probe.mjs', 'scroll-mask.mjs', 'source-pixels.mjs', 'audio-decode.mjs', 'audio-visibility.mjs', 'phaser-rendering-harness.mjs']) {
    const source = read(`examples/web/phaser-probes/${file}`);
    assert.match(source, /import \{ gpuArgs \} from '\.\.\/verify-checks\.mjs'/, `${file} does not import gpuArgs`);
    assert.match(source, /gpuArgs\(\)/, `${file} does not call gpuArgs()`);
    assert.ok(!/--use-angle=\$\{(ANGLE|angle)\}/.test(source), `${file} builds its own --use-angle list`);
  }
});

test('the smoke spec can assert the adapter', () => {
  assert.match(read('examples/web/harness/tests/smoke.spec.mjs'), /EXPECT_GPU/);
});
