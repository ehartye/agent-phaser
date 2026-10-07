// Verify a web scene in headless Chromium: node web/verify.mjs phaser|three [--allow-software] [--autoplay]
// Playwright comes from the agent-beeps checkout (PLAYWRIGHT_DIR overrides) so no second browser download is needed.
// It loads the page, records console errors and failed requests, prints the WebGL renderer string and fails on a
// software renderer (unless --allow-software), samples animation state twice, takes two screenshots, checks that audio
// is locked and silent before one real click and running after it, then triggers the pickup 12 times and checks the
// variant sequence. Chromium runs without an autoplay flag so the gesture gate is real; --autoplay adds one.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { parseArgs, chromiumArgs, rendererCheck, audioGateChecks } from './verify-checks.mjs';

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
const which = opts.page;
const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const playwrightDir = process.env.PLAYWRIGHT_DIR ?? resolve(here, '../../agent-beeps/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(playwrightDir);

const out = resolve(here, 'results');
mkdirSync(out, { recursive: true });
const server = await startServer(0);
const port = server.address().port;

const args = chromiumArgs(opts);
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const consoleErrors = [], failed = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleErrors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', r => failed.push(r.url()));
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

const report = { page: which, started: new Date().toISOString(), chromiumArgs: args, allowSoftware: opts.allowSoftware };
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/web/${which}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__state && window.__state().ready, null, { timeout: 60000 });
report.loadMs = Date.now() - t0;

report.gl = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { webgl2: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
});
const checks = [rendererCheck(report.gl, opts)];
console.log(`renderer: ${checks[0].detail}`);

await page.waitForTimeout(2500);
report.sampleA = await page.evaluate(() => window.__state());
await page.screenshot({ path: `${out}/${which}-a.png` });
await page.waitForTimeout(1300);
report.sampleB = await page.evaluate(() => window.__state());
await page.screenshot({ path: `${out}/${which}-b.png` });

// One real click: a trusted pointer event, the gesture that unlocks audio and starts the music bed. The page.evaluate
// calls above already count as user activation in Chromium, so the gate is read from the page's own state, which only
// its pointer and key handlers change, never from whether an AudioContext would run.
report.beforeClick = report.sampleB;
await page.mouse.click(480, 270);
await page.waitForFunction(() => { const a = window.__state().audio; return a && a.running && a.music && a.music.id === 'survey-drone'; }, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
report.afterUnlock = await page.evaluate(() => window.__state());
checks.push(...audioGateChecks(report.beforeClick, report.afterUnlock));

// 12 pickups, spaced out; override the retrigger cap so only the variant picker decides the sequence
const sequence = [];
for (let i = 0; i < 12; i++) {
  sequence.push(await page.evaluate(() => window.__pickup({ cap: 16, cooldownSec: 0 })));
  await page.waitForTimeout(250); // slower than the 8-voice budget can be exhausted by 1.4 s sounds
}
report.pickupSequence = sequence;
report.pickupChecks = {
  allPlayed: sequence.every(Boolean),
  noImmediateRepeat: sequence.every((f, i) => i === 0 || f !== sequence[i - 1]),
  distinctVariants: [...new Set(sequence)].length,
};
await page.waitForTimeout(500);
report.final = await page.evaluate(() => window.__state());
report.consoleErrors = consoleErrors;
report.failedRequests = failed;
report.checks = checks;
report.pass = checks.every(c => c.pass);
report.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;

writeFileSync(`${out}/${which}-report.json`, JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(JSON.stringify({
  page: which, pass: report.pass, renderer: report.gl.renderer, loadMs: report.loadMs, errors: consoleErrors.length, failed: failed.length,
  music: report.afterUnlock.audio && report.afterUnlock.audio.music, pickups: report.pickupChecks,
  failedChecks: checks.filter(c => !c.pass).map(c => `${c.name} (${c.detail})`),
}, null, 1));
process.exitCode = report.pass ? 0 : 1;
