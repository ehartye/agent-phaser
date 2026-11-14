# Texture memory: budget what the game holds (Phaser 4.2.1)

Read this before the boot scene queues art for more than the first scenes, when adding kinds of thing to a game, and when a phone shows a black screen, reloads the page or says "A problem repeatedly occurred" as a level starts. Loader mechanics are in [loading assets](loading-assets.md). The `texture-` check ids are from the [content-cost probe](../../../examples/web/phaser-probes/phaser-verification-content-cost.mjs).

## What a texture costs

- [tested] A texture costs `width x height x 4` bytes once decoded and uploaded, whatever its file weighs: a 2048 x 2048 PNG of 19,771 bytes became a 16 MiB texture, about 850 times its file (`texture-a-small-png-is-a-large-texture`). The sum over `game.textures.list` grew by exactly that per load; a fresh game holds 8,260 bytes in four built-in textures (`texture-sum-grows-by-width-x-height-x-4-per-load`).
- [documented] That is a floor. Mipmaps add a third, texture data is also kept in system memory, and render targets and filter framebuffers are extra ([textures and render targets](../../phaser-rendering/references/textures-and-render-targets.md)).
- [general] One project queued every creature sheet in its boot scene: about 160 PNGs of 40 to 150 KB each came to about 1.3 GB of textures. Nothing looked wrong on a desktop for weeks; a phone ended the page with a black screen as the first level started. Loading per area brought the held set down to between 180 and 430 MB (sizes counted in headless Chromium, not read from a device).

## Count it

- [tested] Before a browser opens: `node skills/phaser-verification/scripts/assets/texture-memory.mjs <assets folder> --budget-mb <n>` sums the PNG header sizes (bytes 16 to 23 of each file) and exits 1 over the budget. It is the cost of loading the whole folder at once; the offline sum equalled the loaded sum (`texture-offline-png-header-sum-equals-the-loaded-sum`).
- [tested] In a running game: `measureTextures(game)` from the same file sums `source.width * source.height * 4` over `game.textures.list` and lists the largest; `checkTextureBudget(report, bytes)` fails a test over the budget and names the largest texture (`texture-budget-check-fails-over-the-budget-and-names-the-largest`). Both checks are described in [cost of content](../../phaser-verification/references/content-cost.md).

## What a phone allows: not published, so measure

- [general] No browser publishes how much a page may hold, and the page gets no error when it crosses the line: the system ends the process and the browser reloads the page. On iOS Safari a page that allocates the same memory at startup is killed again, and after repeats the browser shows "A problem repeatedly occurred". A developer's report in [WebKit bug 300782](https://bugs.webkit.org/show_bug.cgi?id=300782) says no out-of-memory error reaches JavaScript and no `webglcontextlost` fires first.
- [general] The only figures found are WebKit engineers' statements in bug threads, not documentation. In 2024: a "soft" limit of "around 1.5GB" for a page's process on iPhone, "somewhat lower on iPhone models with less RAM", enforced only when the system wants the memory, so a freshly restarted phone survives what a busy one does not ([bug 277848](https://bugs.webkit.org/show_bug.cgi?id=277848)). In 2018: "about 800MB for the entire web process" ([bug 190518](https://bugs.webkit.org/show_bug.cgi?id=190518)).
- [general] Those figures are per process (JavaScript heap, decoded images and canvases included), and the threads do not say which process a WebGL texture is charged to. No figure was found for Chrome on Android, where the low memory killer ends processes by memory pressure and the device's RAM. None of this is a texture budget, so this skill states no default.
- [general] Measure the budget on the weakest device you support. Add a debug switch that loads more areas' sheets, raise the held sum (read it with `measureTextures`) until the page is killed on a phone that has been in use for a while, not one just restarted, and set the budget well under the last sum that survived. Write the number, the device and the date beside the test that enforces it.

## Load per area, release on leaving

- [general] When the whole game exceeds the budget, load per level or area. When one area exceeds it, shrink the sheets (fewer frames, fewer directions, smaller cells) or use a GPU-compressed format where the art allows ([choosing a format](loading-assets.md)).
A per-area pattern that worked in one project (observed there, not reproduced here):

- [general] Each area names what it can show: its own creatures and props, plus everything those can summon, split into or drop, so nothing appears mid-fight without a sheet.
- [general] On leaving, destroy the game objects and remove the animations that use the old area's sheets, then `textures.remove` every sheet the new area does not name.
- [general] Hold the simulation while a sheet is in flight: step the rules only once every sheet the area names is in the cache, or a creature acts before it can be drawn.
- [general] A kind that turns up unnamed is fetched on first sight (`load.image`, then `load.start()` outside `preload`) with a stand-in until `filecomplete`, and logged so the area's list can be corrected.

What the probe shows about releasing:

- [tested] `textures.remove(key)` gave back exactly the texture's `width x height x 4` and its GL texture wrapper, and removing every loaded sheet returned the sum to the baseline (`texture-remove-gives-the-bytes-and-the-gl-texture-back`). Users must go first ([release memory](loading-assets.md)).
- [tested] Pixels read once for CPU painting need not stay as a texture: an `ImageData` copied from a sheet's source image kept every pixel after `textures.remove(key)` (`texture-pixels-copied-once-outlive-the-texture`). A sheet used only to bake a floor, build a mask or sample colours can be copied and removed.
- [general] Set a scratch canvas's width and height to 0 when done with it: iOS Safari also caps total canvas memory, and [WebKit bug 195325](https://bugs.webkit.org/show_bug.cgi?id=195325) shows "384 MB" in the warning and names that as the way to release one.

## Verify

- [tested] `node examples/web/phaser-probes/phaser-verification-content-cost.mjs <host project>` runs the `texture-` checks on Phaser 4.2.1 (a software renderer is enough: they are counts); `node --test tests/phaser-texture-memory.test.mjs` tests the counters and the command line. Neither measures a page's or a device's memory.
