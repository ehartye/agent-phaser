// node --test examples/web/verify-checks.test.mjs  (no browser, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, chromiumArgs, classifyRenderer, rendererCheck, audioGateChecks, GPU_ARGS } from './verify-checks.mjs';

test('parseArgs takes the page and the two options', () => {
  assert.deepEqual(parseArgs(['phaser']), { page: 'phaser', allowSoftware: false, autoplay: false });
  assert.deepEqual(parseArgs(['three', '--allow-software']), { page: 'three', allowSoftware: true, autoplay: false });
  assert.deepEqual(parseArgs(['--autoplay', 'phaser']), { page: 'phaser', allowSoftware: false, autoplay: true });
});

test('parseArgs refuses an unknown page or option', () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['unity']), /usage/);
  assert.throws(() => parseArgs(['phaser', '--fast']), /usage/);
});

test('chromiumArgs selects the high-performance GPU and leaves autoplay to the gesture by default', () => {
  assert.deepEqual(GPU_ARGS, ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu']);
  const args = chromiumArgs({ autoplay: false });
  assert.deepEqual(args, GPU_ARGS);
  assert.ok(!args.some((a) => a.startsWith('--autoplay-policy')));
  assert.ok(!args.includes('--enable-gpu-rasterization'));
});

test('chromiumArgs adds the autoplay flag only when asked', () => {
  assert.deepEqual(chromiumArgs({ autoplay: true }), [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required']);
});

test('classifyRenderer: a hardware GPU', () => {
  const r = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti Laptop GPU (0x00002F58) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  assert.equal(classifyRenderer({ webgl2: true, renderer: r }), 'gpu');
});

test('classifyRenderer: software renderers are webgl-fallback', () => {
  for (const r of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
    'Google SwiftShader',
  ]) assert.equal(classifyRenderer({ webgl2: true, renderer: r }), 'webgl-fallback', r);
});

test('classifyRenderer: no WebGL 2 context or no string is none', () => {
  assert.equal(classifyRenderer({ webgl2: false }), 'none');
  assert.equal(classifyRenderer({ webgl2: true, renderer: '' }), 'none');
  assert.equal(classifyRenderer(undefined), 'none');
});

test('rendererCheck fails on software unless allowed, and always fails with no context', () => {
  const soft = { webgl2: true, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' };
  const gpu = { webgl2: true, renderer: 'ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)' };
  assert.equal(rendererCheck(gpu, { allowSoftware: false }).pass, true);
  assert.equal(rendererCheck(soft, { allowSoftware: false }).pass, false);
  assert.match(rendererCheck(soft, { allowSoftware: false }).detail, /webgl-fallback/);
  assert.equal(rendererCheck(soft, { allowSoftware: true }).pass, true);
  assert.equal(rendererCheck({ webgl2: false }, { allowSoftware: true }).pass, false);
});

const locked = { unlocked: false, pickups: [], audio: { running: false, voices: 0, music: null } };
const unlocked = { unlocked: true, pickups: [], audio: { running: true, voices: 1, music: { id: 'survey-drone' } } };
const failing = (checks) => checks.filter((c) => !c.pass).map((c) => c.name);

test('audioGateChecks pass when audio is locked and silent before the click and running after it', () => {
  assert.deepEqual(failing(audioGateChecks(locked, unlocked)), []);
});

test('audioGateChecks fail when audio already runs before the click (a vacuous gate)', () => {
  const early = { ...locked, unlocked: true, audio: { running: true, voices: 0, music: null } };
  assert.deepEqual(failing(audioGateChecks(early, unlocked)), ['audio is locked before the click']);
});

test('audioGateChecks fail when something played or music started before the click', () => {
  const played = { ...locked, pickups: ['relic-discovered-1.wav'] };
  assert.deepEqual(failing(audioGateChecks(played, unlocked)), ['nothing played before the click']);
  const music = { ...locked, audio: { running: false, voices: 0, music: { id: 'survey-drone' } } };
  assert.deepEqual(failing(audioGateChecks(music, unlocked)), ['nothing played before the click']);
});

test('audioGateChecks fail when the click does not unlock', () => {
  assert.deepEqual(failing(audioGateChecks(locked, locked)), ['audio runs after one real click']);
  assert.deepEqual(failing(audioGateChecks(locked, undefined)), ['audio runs after one real click']);
});
