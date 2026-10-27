# Loading assets (Phaser 4.2.1)

Where each asset loads, how keys and memory behave and which format to pick; how a failure shows up is in [loading failures](loading-failures.md). Wiring of agent-sprites and agent-beeps output is [asset wiring](asset-wiring.md); recorded audio is [phaser-audio](../../phaser-audio/SKILL.md); Phaser's loader guide is `node_modules/phaser/skills/loading-assets/SKILL.md`. Check ids are from the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs).

## Where to load what

| Moment | Load | Why |
| --- | --- | --- |
| Boot scene | The error screen's font and skin, the loading-bar art | The failure path must not need what failed ([scenes 2](scenes-loop-and-plugins.md)) |
| Preload scene | Everything the first scenes draw, queued by one function `queueAssets(load)` | A scene still loading ignores `start` ([gotcha 11](phaser-4-scene-lifecycle-gotchas.md)) |
| Entering a level | One pack per level | Keeps the first load small and the release a single call |
| On demand | `this.load.start()` outside `preload` | Rare art, user-chosen content |

- [documented] Caches are game-wide (`game.textures`, `game.cache.json`, `.audio`, ...); the per-scene `LoaderPlugin` only queues files and emits events. `SceneManager#bootScene` resets the loader, runs `preload`, then starts it (`src/loader/LoaderPlugin.js`, `src/scene/SceneManager.js`).
- [documented] Outside `preload` you call `load.start()` yourself; it does nothing unless the loader is idle or complete. A scene config `pack: { files: [...] }` loads before `preload` runs, for boot art.
- [tested] A queue that holds only cached keys completes at once: `start()` emits `complete(loader, 0, 0)` synchronously and no `filecomplete-*` event ever fires (`loader-duplicate-key-is-silent-and-completes-at-once`). Wait on `complete`, or test `textures.exists(key)` first.

## Failure, retry and progress

- [tested] `totalFailed` counts transport failures only, so gate the next scene on it and on every requested key existing in its cache. Retries, the timeout trap, malformed JSON and the falling progress bar are in [loading failures](loading-failures.md).

## Keys, caches and lifetime

- [tested] A duplicate key is skipped without a message. `Texture key already in use: <key>` appears when two loads of one key both complete, which is what happens when a loading scene is stopped and started again: the shutdown clears the queue but not the request in flight (`loader-stopping-mid-load-registers-the-key-twice`). A plain `start` on a loading scene is ignored; `stop` then `start` is what double-registers, so do not do it.
- [documented] Each cache has its own key space (an image `hero` and a JSON `hero` coexist); `setPrefix` becomes part of the key; a pack section may set its own `path`, `baseURL` and `prefix`, restored afterwards. Absolute `http`, `https`, `blob`, `data` and `capacitor` URLs bypass `path` (`src/loader/File.js`).
- [general] With Vite, files in `public/` sit at the site root: set `loader.baseURL` from `import.meta.env.BASE_URL` rather than relying on a relative `assets/` path.
- [tested] `anims.createFromAseprite(key)` reads `cache.json[key].frames[String(i)]` for each tag. Frames keyed `"0"`, `"1"` (or an array in order) work; frames named like `walk 0.aseprite` give a tag animation with zero frames and no warning. A second call for the same tag warns `AnimationManager key already exists` (`loader-aseprite-frames-must-be-numeric-keys`). `load.aseprite` also accepts a parsed object instead of a URL and stores the JSON under the same key.
- [general] Animations are global, so create them once after loading, namespaced per atlas ([gotcha 5](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md)), not in every scene's `create`.

## Choosing a format

| Asset | Call | Decide |
| --- | --- | --- |
| One picture | `image` | Add a normal map as `[png, normalPng]` |
| Equal grid | `spritesheet` | Frames by index, `margin` and `spacing` |
| Packed named frames | `atlas`, `atlasXML`, `unityAtlas`; `multiatlas` for several pages | JSON hash or array |
| Aseprite animation | `aseprite` + `anims.createFromAseprite` | Numeric frame keys; Phaser ignores the pivot slice |
| Many atlases, small descriptor | `atlasPCT` | New in 4.0.0: a text `.pct` file the changelog gives as 90 to 95% smaller than JSON |
| Bitmap font | `bitmapFont(key, png, xml)` | XML descriptor ([phaser-pixel-ui](../../phaser-pixel-ui/SKILL.md)) |
| GPU-compressed texture | `texture(key, { ASTC, ETC, PVRTC, S3TC, IMG })` | Memory-bound mobile art only; never pixel art |
| Stand-in while art loads | `textures.addFlatColor(key, w, h, color, alpha)` | Alpha defaults to 0 |

- [documented] `texture` takes the first format in object key order that the GPU supports, so put `IMG` (a PNG fallback) last. Phaser 4 expects compressed files with the Y axis flipped; a format the GPU rejects only logs `Compressed Texture Invalid`, often because the file is sRGB instead of linear. PVRTC needs power-of-two sizes and S3TC multiples of 4 (`src/loader/filetypes/CompressedTextureFile.js`, `docs/WebGL Compressed Textures`).
- [documented] `game.renderer.getMaxTextureSize()` reports the largest atlas side; Phaser's guide treats 4096 as the safe mobile ceiling.

- [documented] Phaser 4.2.1 has no glTF or GLB loader. `src/loader/filetypes` holds 34 `*File.js` file types (plus `index.js` and `typedefs`), none for glTF, and `Mesh2D` is 2D ([mesh2d](../../phaser-rendering/references/mesh2d-and-triangle-batching.md)). Re-check with `ls node_modules/phaser/src/loader/filetypes` after an upgrade.

## Release memory

- [tested] `load.removePack(packKey)` removes the textures and cache entries a pack added: three pack images freed three GL texture wrappers. The pack JSON itself stays cached; remove it with `cache.json.remove` (`loader-pack-progress-falls-back-and-remove-pack-frees-textures`).
- [documented] `textures.remove(key)` destroys the texture and its GL texture at once. Game objects still showing it fail on the next render, and animations that name its frames stay in the global manager until `anims.remove` (`src/textures/TextureManager.js`). Swap or destroy the users first.
- [general] In a restart or level-change test, assert that `textures.getTextureKeys().length` and `renderer.glTextureWrappers.length` return to their starting values.

## Verify

- [tested] `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project> --only=loader` runs every check named above against a local server with scripted 404s and aborted requests.
