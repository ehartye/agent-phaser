# Loading assets: failure, retry and progress (Phaser 4.2.1)

How a load fails, what the gate after `complete` must check, the loader timeout trap and why a progress bar falls. Where to load what, keys, formats and memory are in [loading assets](loading-assets.md). Check ids are from the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs).

## Failure, retry and progress

- [tested] An HTTP 404 or 5xx is not retried (one request). A network failure or timeout is retried `loader.maxRetries` times (default 2, so three requests) (`loader-http-errors-are-not-retried-network-errors-are`). `loader.timeout` defaults to 0, which never times out, so one hung request stalls `complete` forever; set a timeout, but see the timeout bullet below.
- [documented] With `imageLoadType: 'HTMLImageElement'` an image error goes straight to failure with no retry (`src/loader/filetypes/ImageFile.js`).
- [tested] `complete(loader, totalComplete, totalFailed)` fires even when files failed, and a failed key is simply absent, so a later `add.image('gone')` draws the green missing-texture box. `totalFailed` counts transport failures only (HTTP errors, network failures, timeouts). A 200 response whose bytes cannot be processed, such as an image that will not decode (a dev server's `index.html` fallback for a missing image does this), raises no `loaderror`, leaves `totalFailed` alone and logs one `Failed to process file` line (`loader-decode-failure-is-not-counted-in-total-failed`). Gate the next scene on `totalFailed === 0` and on every requested key existing in its cache, and show failures:

```js
const failures = [];
const wanted = [['image', 'hero'], ['json', 'level1']];                 // the keys your manifest queued
this.load.on('loaderror', (file) => failures.push(`${file.type}:${file.key} <- ${file.src}`));
this.load.once('complete', (_loader, _ok, failed) => {
  const missing = wanted.filter(([type, key]) => !(type === 'image' ? this.textures : this.cache[type]).exists(key));
  this.scene.start(failed || missing.length ? 'boot-error' : 'title', { failures, missing });
});
```

- [tested] `loader.timeout` is not inherited by files. With `loader: { timeout: 200 }` a file that set nothing still sent its XHR with `timeout` 0 (its default replaces the global value) and a hung response never ended the load; an explicit per-file `{ timeout: 300 }` was kept. An `addfile` handler that sets `file.xhrSettings.timeout = this.load.xhr.timeout` when it is 0 made both fail finitely (`loader-global-timeout-is-overridden-by-the-file-default`). Check the request's own timeout, not the config.
- [tested] A JSON, atlas or Aseprite response that is 200 but not valid JSON leaves its key absent (the cache check sees it) yet the loader's XHR callback still throws an uncaught `SyntaxError` that a `pageerror` gate will flag (`loader-malformed-json-throws-after-failed-processing`). Validate authored and generated JSON before shipping.

- [tested] Progress can fall. A pack queues its files only after the pack file arrives, so the bar reaches 1, then drops to 0.5, 0.33 and climbs again (`loader-pack-progress-falls-back-and-remove-pack-frees-textures`).
- [documented] `multiatlas` and `atlasPCT` queue their page images the same way, after the descriptor loads (`src/loader/filetypes/MultiAtlasFile.js`, `PCTAtlasFile.js`). [general] Show `Math.max(previous, progress)` or count files from your own manifest.
