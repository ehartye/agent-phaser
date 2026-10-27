import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// One port per checkout: parallel worktrees would otherwise collide on a fixed port, or (with server reuse) test each other's code.
// PW_PORT overrides; the main process leaves its answer in the environment because the workers load this file again.
if (!process.env.PW_PORT) {
  const checkout = dirname(fileURLToPath(import.meta.url));
  process.env.PW_PORT = String(5100 + (parseInt(createHash('sha1').update(checkout).digest('hex').slice(0, 8), 16) % 100));
  console.log(`[harness] port ${process.env.PW_PORT} (from this checkout's path; set PW_PORT to choose)`);
}
const port = process.env.PW_PORT;
// SOFTWARE_GL=1 (CI with no GPU): Chromium on its own SwiftShader; tests tagged @gpu are skipped (tests/fixtures.mjs).
const software = !!process.env.SOFTWARE_GL;
// Platform ANGLE backend for a real GPU, with the flags of gpuArgs() in ../verify-checks.mjs (tests/launch-flags.test.mjs keeps the two lists equal).
// --force_high_performance_gpu picks the discrete GPU on a laptop with two and is harmless on one; set EXPECT_GPU to assert the adapter (tests/smoke.spec.mjs).
const backend = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const args = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [`--use-angle=${backend}`, '--ignore-gpu-blocklist', '--force_high_performance_gpu'];

if (process.argv.some((a) => /firefox|webkit/.test(a))) process.env.OTHER_ENGINES = '1';
const otherEngines = !!process.env.OTHER_ENGINES;

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs/,
  timeout: 60_000,
  // Every worker is a browser with its own WebGL context that loads the page: eight on one GPU exhaust memory and push the first load past
  // any fixed wait. Specs wait on state, so the count is a resource choice, not a correctness one. Two by default.
  workers: Number(process.env.PW_WORKERS ?? 2),
  retries: process.env.CI ? 2 : 1,                   // a retry that was needed is reported as "flaky", not hidden
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 640, height: 360 }, trace: 'retain-on-failure', launchOptions: { args } },
  projects: [
    { name: 'chromium' },
    // Other engines are opt-in (`--project=firefox`), because they need `npx playwright install firefox webkit` and no GPU flags (the Chromium
    // arguments are not theirs).
    // (The workers load this file without the command line, so the main process leaves its answer in the environment.)
    ...(otherEngines ? [
      { name: 'firefox', use: { browserName: 'firefox', launchOptions: {} } },
      { name: 'webkit', use: { browserName: 'webkit', launchOptions: {} } },
    ] : []),
  ],
  webServer: { command: `node serve.mjs ${port}`, url: `http://127.0.0.1:${port}/`, reuseExistingServer: false, timeout: 30_000 },   // strict: a real collision fails loudly instead of testing another tree's server
});
