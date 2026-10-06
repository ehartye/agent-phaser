// Evaluate an expression inside the running game and print the result: node tools/probe.mjs "<js using game>"
import { chromium } from '@playwright/test';
const expr = process.argv[2];
const url = process.argv[3] ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${url}/?seed=1`);
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const result = await page.evaluate(`(() => { const game = (globalThis.__game ?? globalThis.__fallow); return (${expr}); })()`);
console.log(JSON.stringify({ result, errors }, null, 2));
await browser.close();
