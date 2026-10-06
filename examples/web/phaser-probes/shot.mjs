// Drive the running dev server in headless Chromium on the GPU: start a world, optionally run a script, screenshot, report errors.
// usage: node tools/shot.mjs [--seed=1] [--out=shots/a.png] [--keys=d:600,s:400] [--click=x,y] [--url=http://localhost:5173]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const seed = arg('seed', '1'), out = arg('out', 'shots/shot.png'), url = arg('url', 'http://localhost:5173');
const keys = arg('keys', '').split(',').filter(Boolean).map((s) => s.split(':'));
const wait = Number(arg('wait', '1200'));
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${url}/?seed=${seed}`);
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForTimeout(wait);
for (const [key, ms] of keys) { await page.keyboard.down(key); await page.waitForTimeout(Number(ms)); await page.keyboard.up(key); }
const ev = arg('eval', ''); if (ev) { await page.evaluate(`(() => { const game = (globalThis.__game ?? globalThis.__fallow); ${ev} })()`); await page.waitForTimeout(300); }
const click = arg('click', '');
if (click) { const [x, y] = click.split(',').map(Number); await page.mouse.click(x, y); await page.waitForTimeout(400); }
await page.waitForTimeout(300);
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const g = (globalThis.__game ?? globalThis.__fallow); const gl = g?.renderer?.gl;
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a', fps: Math.round(g?.loop?.actualFps ?? 0), scenes: g?.scene.getScenes(true).map((s) => s.sys.settings.key) };
});
console.log(JSON.stringify({ out, info, errors }, null, 2));
await browser.close();
