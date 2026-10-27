# Verifying a Phaser game: the Playwright setup

Browser launch configuration and keeping frozen evidence outside live inputs. Index: [verifying-on-a-gpu.md](verifying-on-a-gpu.md).

## Playwright configuration

```ts
// playwright.config.ts
import { createHash } from 'node:crypto';
// ANGLE backend by platform: d3d11 on Windows, metal on macOS, gl elsewhere
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
// One strict port per checkout (5100-5199, from this folder's path), so parallel worktrees neither collide nor reuse each other's server
const port = process.env.PW_PORT ?? String(5100 + (parseInt(createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8), 16) % 100));
export default defineConfig({
  testDir: 'tests/browser',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--force_high_performance_gpu'] },   // same as gpuArgs()
  },
  webServer: { command: `npx vite --config vite.evidence.config.mjs --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
```

- [general] A fixed port fails loudly when a sibling worktree already holds it (`is already used`), and with `reuseExistingServer: true` it passes against the other tree's code. Derive the port from the checkout as above, keep it strict, and print it in the run header. A 1-in-100 hash clash between two checkouts still fails with the strict-port error, so it never goes unnoticed. The harness template does this in [`playwright.config.mjs`](../../../examples/web/harness/playwright.config.mjs).
- [general] A game page should declare an icon (`<link rel="icon" href="data:,">`) or its dev server should answer `/favicon.ico` (204). In one run (Windows, Playwright 1.63.0, Chromium 153), `channel: 'chromium'` requested it and a 404 produced `Failed to load resource: the server responded with a status of 404`, which a console-error gate reports and which names no URL; the default headless shell made no such request. Log failed request URLs (`requestfailed`, or the server log) next to the console gate so a favicon is told apart from a missing game file.

- [general] The same three flags are exported as `gpuArgs()` (with `angleBackend()`) from [`examples/web/verify-checks.mjs`](../../../examples/web/verify-checks.mjs).
  On a hybrid-GPU laptop the first two are not enough. [tested] On one Windows 11 laptop with an integrated and a discrete GPU (Playwright 1.63.0,
  Chromium 153): no flags rendered on SwiftShader (software), `--use-angle=d3d11 --ignore-gpu-blocklist` selected the integrated GPU, and adding
  `--force_high_performance_gpu` selected the discrete GPU (reproduced with `examples/web/verify.mjs`). Which GPU Chromium picks varies by machine,
  driver and power state, and the last flag is harmless on single-GPU machines. [tested] That "no flags" run was Playwright's default headless shell; on the same machine `channel: 'chromium'` (new headless, the full browser) picked a hardware GPU with no flags, and `--disable-gpu` still gave a software WebGL context (`examples/web/phaser-probes/phaser-verification-renderer.mjs`; [CI for Phaser](ci-for-phaser.md)). Print the renderer string on every run and fail on software (below),
  since software WebGL raises no error; assert the string you expect when a test needs the discrete GPU.

For frozen acceptance, own the server, source root, configuration and cache identity. Choose a free strict port and a fresh cache directory;
do not attach to an unidentified existing server. Keep full raw server stdout/stderr from before process spawn, not only a tail sample.
Record the PID, pinned Vite version/module hashes, source/config hashes, origin and actual served optimized dependency URL/response hash
alongside its cache metadata and file hash. A source freeze alone does not identify the optimized code served to the browser.

[tested] Vite 8.3.3 served the standalone Phaser fixture's exact cached-code prefix followed by an inline base64 source map;
the full response therefore had a different hash from the cache file. Record both hashes, compare the code prefix exactly,
decode the served map and tie its embedded source bytes to the actual consumed `phaser.esm.js`. That served map added only
`x_google_ignoreList: [0]` to the parsed cache map. Validate this observed addition and compare every other field exactly;
do not require raw map byte equality or normalize unknown differences. This is evidence for that pinned Vite fixture,
not a guarantee about other versions or dependency graphs.

### Keep frozen evidence outside Vite's live inputs

Prefer source snapshots, logs and trace resources outside the Vite root. Git-ignore is not watcher isolation; a unique `cacheDir` only
isolates that cache, not evidence elsewhere. Vite 8.3.3's [watcher defaults](https://raw.githubusercontent.com/vitejs/vite/v8.3.3/docs/config/server-options.md)
omit `.local`. A watched copied `tsconfig.json` forces a full reload, and captured HTML can emit reloads. This can reset game/audio state
without changing product source. The separate [HTML dependency scan](https://raw.githubusercontent.com/vitejs/vite/v8.3.3/docs/config/dep-optimization-options.md)
also needs exact real entry points; watcher ignores do not set scanner entries.

If evidence must live in `.local`, reserve that subtree for evidence/tooling and explicitly exclude it. Extend the app's config instead
of replacing its plugins or aliases; this example assumes the existing config is `vite.config.mjs`. Replace `index.html` with every real
app HTML entry (for example, `['index.html', 'phaser.html']`), choose an unused port and change the run ID for each frozen acceptance:

```js
// vite.evidence.config.mjs: keep the app's plugins, aliases and other settings.
import {defineConfig,mergeConfig,normalizePath} from 'vite';
import {resolve} from 'node:path';
import appConfig from './vite.config.mjs';

export default defineConfig(async env=>{
  const app=await (typeof appConfig==='function'?appConfig(env):appConfig);
  const root=resolve(app.root??'.');
  const evidence=normalizePath(resolve(root,'.local'));
  const config=mergeConfig(app,{
    cacheDir:resolve(root,'../.vite-evidence-cache/run-20261007-a'), // Fresh run ID.
    server:{host:'127.0.0.1',port:5199,strictPort:true,watch:{ignored:[file=>{
      const path=normalizePath(file);
      return path===evidence||path.startsWith(evidence+'/');
    }]}}
  });
  // Replace after merging: mergeConfig concatenates arrays, including entries.
  config.optimizeDeps={...config.optimizeDeps,entries:['index.html']}; // All real app HTML entries.
  return config;
});
```

Keep native HMR and dependency optimization enabled for actual app source. Before freezing, verify the configuration in a small isolated
fixture using the installed Vite: copied `.local` tsconfig/trace-HTML writes must produce no watcher/HMR events during a bounded observation,
while an actual app HTML/source edit still produces native reload/update events. Check native cache metadata for app dependencies and the
absence of snapshot-only dependencies, then fetch the app's actual optimized import. Close owned sockets, watchers and server and verify
the PID/port cleanup. Do not mutate frozen product source for this positive control.

A Windows Node 24/Vite 8.3.3 fixture verified these behaviors with native WebSocket events and one-second negative observation windows.
Its scan proof used visible snapshot HTML; hidden `.local` HTML was not a default scan entry there. This proves the configuration boundary,
not the historical cause of every game failure or a fresh Phaser/audio/GPU pass. Recheck the bounded controls after a Vite upgrade.

Expose the game for tests with `globalThis.__game = game`. Assert that the renderer string is not software:

```ts
const gl = game.renderer.gl; const ext = gl.getExtension('WEBGL_debug_renderer_info');
expect(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))).not.toMatch(/swiftshader|llvmpipe|software|basic render/i);
```
