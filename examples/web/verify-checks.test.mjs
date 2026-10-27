// node --test examples/web/verify-checks.test.mjs  (no browser, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, chromiumArgs, classifyRenderer, rendererCheck, readGlContext, audioGateChecks, gpuArgs, angleBackend } from './verify-checks.mjs';

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

test('angleBackend picks the platform backend that reaches a real GPU', () => {
  assert.equal(angleBackend('win32'), 'd3d11');
  assert.equal(angleBackend('darwin'), 'metal');
  assert.equal(angleBackend('linux'), 'gl');
});

test('chromiumArgs selects the high-performance GPU and leaves autoplay to the gesture by default', () => {
  assert.deepEqual(gpuArgs('win32'), ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu']);
  assert.deepEqual(gpuArgs('darwin')[0], '--use-angle=metal');
  const args = chromiumArgs({ autoplay: false });
  assert.deepEqual(args, gpuArgs());
  assert.ok(!args.some((a) => a.startsWith('--autoplay-policy')));
  assert.ok(!args.includes('--enable-gpu-rasterization'));
});

test('chromiumArgs adds the autoplay flag only when asked', () => {
  assert.deepEqual(chromiumArgs({ autoplay: true }), [...gpuArgs(), '--autoplay-policy=no-user-gesture-required']);
});

const GPU = 'ANGLE (Example Vendor, Example Discrete GPU (0x00001234) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SOFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

test('classifyRenderer: a hardware GPU, in a WebGL 2 or a WebGL 1 context', () => {
  assert.equal(classifyRenderer({ context: 'webgl2', renderer: GPU }), 'gpu');
  assert.equal(classifyRenderer({ context: 'webgl1', renderer: GPU }), 'gpu');          // Phaser creates WebGL 1 by default
});

test('classifyRenderer: software renderers are webgl-fallback in either context', () => {
  for (const r of [SOFT, 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Google SwiftShader']) {
    assert.equal(classifyRenderer({ context: 'webgl2', renderer: r }), 'webgl-fallback', r);
    assert.equal(classifyRenderer({ context: 'webgl1', renderer: r }), 'webgl-fallback', r);
  }
});

test('classifyRenderer: no context or no string is none', () => {
  assert.equal(classifyRenderer({ context: 'none' }), 'none');
  assert.equal(classifyRenderer({ context: 'webgl2', renderer: '' }), 'none');
  assert.equal(classifyRenderer({ context: 'webgl1' }), 'none');
  assert.equal(classifyRenderer(undefined), 'none');
});

test('rendererCheck fails on software unless allowed, always fails with no context, and says which context it classified', () => {
  const soft = { context: 'webgl2', source: 'page', renderer: SOFT };
  const gpu1 = { context: 'webgl1', source: 'page', renderer: 'ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)' };
  assert.equal(rendererCheck(gpu1, { allowSoftware: false }).pass, true);                // a WebGL 1 game on hardware passes
  assert.match(rendererCheck(gpu1, { allowSoftware: false }).detail, /webgl1 from the page's own context/);
  assert.match(rendererCheck({ ...gpu1, source: 'fresh-canvas' }, { allowSoftware: false }).detail, /from the fresh canvas/);
  assert.equal(rendererCheck(soft, { allowSoftware: false }).pass, false);
  assert.match(rendererCheck(soft, { allowSoftware: false }).detail, /webgl-fallback/);
  assert.equal(rendererCheck(soft, { allowSoftware: true }).pass, true);
  assert.equal(rendererCheck({ context: 'none', source: 'fresh-canvas' }, { allowSoftware: true }).pass, false);
});

// readGlContext runs in the page; here it runs against stand-ins for the page globals.
function withPage({ pageGl, fresh }, fn) {
  class GL1 {}
  class GL2 extends GL1 {}
  const context = (kind, renderer) => Object.assign(Object.create((kind === 2 ? GL2 : GL1).prototype), {
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 7 }), getParameter: () => renderer, RENDERER: 1,
  });
  const saved = { window: globalThis.window, document: globalThis.document, WebGL2RenderingContext: globalThis.WebGL2RenderingContext };
  globalThis.WebGL2RenderingContext = GL2;
  globalThis.window = { __gl: pageGl ? context(pageGl.v, pageGl.renderer) : undefined };
  globalThis.document = { createElement: () => ({ getContext: (name) => (fresh && fresh[name] ? context(name === 'webgl2' ? 2 : 1, fresh[name]) : null) }) };
  try { return fn(); } finally { Object.assign(globalThis, saved); for (const k of Object.keys(saved)) if (saved[k] === undefined) delete globalThis[k]; }
}

test('readGlContext classifies the own context of the page, not a fresh canvas', () => {
  const r = withPage({ pageGl: { v: 1, renderer: GPU }, fresh: { webgl2: SOFT } }, readGlContext);
  assert.deepEqual(r, { context: 'webgl1', source: 'page', renderer: GPU });          // the fresh WebGL 2 canvas is software; the game's context is not
});

test('readGlContext falls back to a fresh canvas only when the page exposes none, WebGL 2 first and then WebGL 1', () => {
  assert.deepEqual(withPage({ fresh: { webgl2: GPU } }, readGlContext), { context: 'webgl2', source: 'fresh-canvas', renderer: GPU });
  assert.deepEqual(withPage({ fresh: { webgl: GPU } }, readGlContext), { context: 'webgl1', source: 'fresh-canvas', renderer: GPU });
  assert.deepEqual(withPage({ fresh: {} }, readGlContext), { context: 'none', source: 'fresh-canvas' });
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
