// Pure parts of verify.mjs: arguments, Chromium flags, the renderer check and the audio gate checks.
// No browser and no dependencies, so `node --test examples/web/verify-checks.test.mjs` covers them.

/**
 * Windows flags that put headless Chromium on the high-performance GPU. Measured in Sector Run on a hybrid laptop
 * (Intel integrated plus NVIDIA RTX 5070 Ti Laptop): no flags gave SwiftShader, `--use-angle=d3d11` alone the Intel
 * GPU, and `--force_high_performance_gpu` added the NVIDIA one. Use the platform's ANGLE backend elsewhere.
 */
export const GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--force_high_performance_gpu'];

/** Lets audio start without a gesture. It hides the gesture gate, so it is opt-in (`--autoplay`). */
export const AUTOPLAY_ARG = '--autoplay-policy=no-user-gesture-required';

/** Software rasterisers: WebGL works on them with no error, so only the renderer string gives them away. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

const PAGES = ['phaser', 'three'];
const USAGE = 'usage: node web/verify.mjs phaser|three [--allow-software] [--autoplay]';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { page: '', allowSoftware: false, autoplay: false };
  for (const a of argv) {
    if (a === '--allow-software') out.allowSoftware = true;
    else if (a === '--autoplay') out.autoplay = true;
    else if (PAGES.includes(a) && !out.page) out.page = a;
    else throw new Error(USAGE);
  }
  if (!out.page) throw new Error(USAGE);
  return out;
}

/** @param {{ autoplay: boolean }} opts */
export function chromiumArgs({ autoplay }) {
  return autoplay ? [...GPU_ARGS, AUTOPLAY_ARG] : [...GPU_ARGS];
}

/**
 * @param {{ webgl2: boolean, renderer?: string } | undefined} gl
 * @returns {'gpu' | 'webgl-fallback' | 'none'}
 */
export function classifyRenderer(gl) {
  if (!gl || !gl.webgl2 || !gl.renderer) return 'none';
  return SOFTWARE_RENDERER.test(gl.renderer) ? 'webgl-fallback' : 'gpu';
}

/** @param {{ webgl2: boolean, renderer?: string } | undefined} gl @param {{ allowSoftware: boolean }} opts */
export function rendererCheck(gl, { allowSoftware }) {
  const kind = classifyRenderer(gl);
  const pass = kind === 'gpu' || (kind === 'webgl-fallback' && allowSoftware);
  return { name: 'renderer is a hardware GPU', pass, detail: `${kind}: ${gl && gl.renderer ? gl.renderer : 'no WebGL 2 renderer string'}` };
}

/**
 * The gesture gate, from two `__state()` samples: one before and one after a real (trusted) click.
 * Playwright's `page.evaluate` counts as user activation, so a context created by an evaluate would run; the
 * page must create or resume audio only from its own pointer or key handler.
 */
export function audioGateChecks(before, after) {
  const b = before || {}, ba = b.audio || {};
  const a = after || {}, aa = a.audio || {};
  return [
    { name: 'audio is locked before the click', pass: b.unlocked === false && ba.running === false,
      detail: `unlocked ${b.unlocked}, running ${ba.running}` },
    { name: 'nothing played before the click', pass: (b.pickups || []).length === 0 && !ba.music && !ba.voices,
      detail: `pickups ${(b.pickups || []).length}, music ${ba.music ? ba.music.id : null}, voices ${ba.voices}` },
    { name: 'audio runs after one real click', pass: a.unlocked === true && aa.running === true,
      detail: `unlocked ${a.unlocked}, running ${aa.running}` },
  ];
}
