// Pure parts of run-all.mjs: which files are probes, which lane each runs in, argument parsing and the pass/fail/skipped tally.
// No browser and no child processes, so tests/phaser-probes-run-all.test.mjs covers them in the merge lane.

/**
 * Lane of a probe:
 *   software  runs on headless Chromium with a software rasteriser, and gives the same answer under --hardware
 *   either    runs on software by default; --hardware asks the platform GPU backend (PROBE_GL=hardware, ANGLE=<backend>)
 *   hardware  needs a GPU and is skipped without --hardware
 *   manual    needs arguments run-all cannot supply (isolated package copies, an evidence directory) and is never run here
 */
export const LANES = ['software', 'either', 'hardware', 'manual'];

const rendering = ['render-graph', 'filters', 'stencil', 'mesh-and-gpu-layer', 'textures-and-shaders', 'webgl2-context', 'pixel-filters', 'smooth-pixel-art'].map(n => ({ file: `phaser-rendering-${n}.mjs`, lane: 'either' }));
const worlds = ['cameras', 'layers', 'lights', 'normal-atlas', 'particles', 'tilemaps'].map(n => ({ file: `phaser-worlds-${n}.mjs`, lane: 'either' }));
const software = ['engine-phaser-foundations', 'phaser-audio-manager', 'phaser-audio-sounds', 'phaser-input-gamepad', 'phaser-input-keyboard', 'phaser-input-pointer', 'phaser-motion-clocks', 'phaser-motion-scenes',
  'phaser-physics-arcade', 'phaser-physics-matter', 'phaser-physics-paths', 'phaser-physics-tilemap', 'phaser-pixel-ui-panels', 'phaser-pixel-ui-text',
  'phaser-verification-driving', 'phaser-verification-leaks', 'phaser-verification-pixels', 'phaser-verification-renderer', 'phaser-native-control-observation', 'phaser-pixel-ui-accessibility-bridge', 'phaser-verification-evidence-kit'].map(n => ({ file: `${n}.mjs`, lane: 'software' }));

/** In run order. The errata check needs no browser, so it goes first and a Phaser upgrade names the stale documents before anything slower runs. */
export const PROBES = [
  { file: 'phaser-docs-errata.mjs', lane: 'software' },
  ...software,
  ...rendering,
  ...worlds,
  { file: 'scroll-mask.mjs', lane: 'hardware' },
  { file: 'source-pixels.mjs', lane: 'hardware' },
  { file: 'phaser-verification-causal-pixels.mjs', lane: 'hardware' },
  { file: 'audio-decode.mjs', lane: 'manual' },
  { file: 'audio-visibility.mjs', lane: 'manual' },
  { file: 'phaser-capture-ready.mjs', lane: 'manual' },
  { file: 'phaser-capture-clock-experiment.mjs', lane: 'manual' },
];

/** Files in this folder that are not probes, so a new file has to be put in one list or the other (tests/phaser-probes-run-all.test.mjs). */
export const NON_PROBES = [
  'errata-rows.mjs',                   // reads the errata tables for the check and the merge-lane test
  'phaser-rendering-harness.mjs',      // shared by the rendering probes
  'phaser-worlds-lib.mjs',             // shared by the worlds probes
  'run-all-lib.mjs', 'run-all.mjs',    // this runner
  'probe.mjs', 'shot.mjs',             // debugging helpers that need a game already running at a URL
];

const USAGE = 'usage: node run-all.mjs <host-project> [--hardware] [--only <prefix>] [--timeout <seconds>] [--channel <name>] [--list]';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { host: '', hardware: false, only: '', timeoutSec: 240, channel: '', list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value. ${USAGE}`); return argv[++i]; };
    if (a === '--hardware') out.hardware = true;
    else if (a === '--list') out.list = true;
    else if (a === '--only') out.only = value();
    else if (a === '--channel') out.channel = value();
    else if (a === '--timeout') {
      out.timeoutSec = Number(value());
      if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) throw new Error(`--timeout must be a positive number of seconds. ${USAGE}`);
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}. ${USAGE}`);
    else if (!out.host) out.host = a;
    else throw new Error(USAGE);
  }
  if (!out.host && !out.list) throw new Error(USAGE);
  return out;
}

/** The ANGLE backend that reaches a real GPU, as in verify-checks.mjs. */
const backend = (platform = process.platform) => (platform === 'win32' ? 'd3d11' : platform === 'darwin' ? 'metal' : 'gl');

/**
 * What to do with each probe under these options. A skipped probe carries the reason; a probe that runs carries the environment it
 * should get (the one place the probes' differing knobs are set: CHROME_CHANNEL, PROBE_GL for the rendering probes, ANGLE for the worlds probes).
 * @param {ReturnType<typeof parseArgs>} options
 */
export function plan(options, { platform = process.platform, env = {} } = {}) {
  const wanted = PROBES.filter(p => !options.only || p.file.startsWith(options.only));
  if (!wanted.length) throw new Error(`--only ${options.only} matches no probe`);
  return wanted.map(probe => {
    if (probe.lane === 'manual') return { ...probe, action: 'skip', reason: 'needs extra arguments, run it by hand (see its header)' };
    if (probe.lane === 'hardware' && !options.hardware) return { ...probe, action: 'skip', reason: 'needs --hardware' };
    const childEnv = { ...env };
    if (options.channel) childEnv.CHROME_CHANNEL = options.channel;
    if (options.hardware && probe.lane === 'either') { childEnv.PROBE_GL = 'hardware'; childEnv.ANGLE = backend(platform); }
    return { ...probe, action: 'run', env: childEnv };
  });
}

/** @param {number | null} code @param {boolean} timedOut */
export function describeExit(code, timedOut) {
  if (timedOut) return { status: 'fail', note: 'timed out' };
  if (code === 0) return { status: 'pass', note: '' };
  if (code === 2) return { status: 'fail', note: 'exit 2: wrong Phaser version or bad arguments' };
  return { status: 'fail', note: `exit ${code}` };
}

/**
 * @param {{ status: 'pass' | 'fail' | 'skipped' }[]} results
 * @returns {{ passed: number, failed: number, skipped: number, exit: 0 | 1 }}
 */
export function summarize(results) {
  const count = status => results.filter(r => r.status === status).length;
  const failed = count('fail');
  return { passed: count('pass'), failed, skipped: count('skipped'), exit: failed ? 1 : 0 };
}
