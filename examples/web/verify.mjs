// Verify a web scene in headless Chromium: node web/verify.mjs phaser|three
// Playwright comes from the agent-beeps checkout (PLAYWRIGHT_DIR overrides) so no second browser download is needed.
// It loads the page, records console errors and failed requests, samples animation state twice, takes two screenshots,
// unlocks audio with a real click, then triggers the pickup 12 times and checks the variant sequence.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const which = process.argv[2];
if (!['phaser', 'three'].includes(which)) throw new Error('usage: node web/verify.mjs phaser|three');
const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const playwrightDir = process.env.PLAYWRIGHT_DIR ?? resolve(here, '../../agent-beeps/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(playwrightDir);

const out = resolve(here, 'results');
mkdirSync(out, { recursive: true });
const server = await startServer(0);
const port = server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const consoleErrors = [], failed = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleErrors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', r => failed.push(r.url()));
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

const report = { page: which, started: new Date().toISOString() };
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

await page.waitForTimeout(2500);
report.sampleA = await page.evaluate(() => window.__state());
await page.screenshot({ path: `${out}/${which}-a.png` });
await page.waitForTimeout(1300);
report.sampleB = await page.evaluate(() => window.__state());
await page.screenshot({ path: `${out}/${which}-b.png` });

// a real click is the user gesture that unlocks audio and starts the music bed
await page.mouse.click(480, 270);
await page.waitForFunction(() => { const a = window.__state().audio; return a && a.running && a.music && a.music.id === 'survey-drone'; }, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
report.afterUnlock = await page.evaluate(() => window.__state());

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
report.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;

writeFileSync(`${out}/${which}-report.json`, JSON.stringify(report, null, 2));
await browser.close();
server.close();
console.log(JSON.stringify({
  page: which, renderer: report.gl.renderer, loadMs: report.loadMs, errors: consoleErrors.length, failed: failed.length,
  music: report.afterUnlock.audio && report.afterUnlock.audio.music, pickups: report.pickupChecks,
}, null, 1));
