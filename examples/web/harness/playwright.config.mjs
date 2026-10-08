import { defineConfig } from '@playwright/test';

const port = process.env.PW_PORT ?? '5199';
// SOFTWARE_GL=1 (CI with no GPU): Chromium on its own SwiftShader; tests tagged @gpu are skipped (tests/fixtures.mjs).
const software = !!process.env.SOFTWARE_GL;
// Platform ANGLE backend for a real GPU. On a laptop with two GPUs add '--force_high_performance_gpu' (see verifying-on-a-gpu.md).
const backend = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const args = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [`--use-angle=${backend}`, '--ignore-gpu-blocklist'];

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
  webServer: { command: `node serve.mjs ${port}`, url: `http://127.0.0.1:${port}/`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
