# Declared RGBA regions and native text fit

Use these bounded instruments to measure supplied bytes and native fixture text. They do not score visual quality. Run the dependency-free vectors with `node --test tests/phaser-verification-evidence-kit.test.mjs`; run native evidence with `node examples/web/phaser-probes/phaser-verification-evidence-kit.mjs <host>` using Phaser 4.2.1 and Playwright in the host.

## Exact byte contract

- [tested] [`measureRgbaRegion`](../scripts/assets/measure-rgba-regions.mjs) accepts one object containing `rgba` (`Uint8Array` or `Uint8ClampedArray`), positive integer `width`/`height`, an in-image integer `region: {x,y,width,height}`, a nonempty array of four-channel byte `palette` entries, and `grid: {size,originX,originY}`. Missing or malformed buffers, dimensions, regions, palettes and grids throw before measurement. The [public vector tests](../../../tests/phaser-verification-evidence-kit.test.mjs) cover the input boundary and immutable input.
- [tested] Membership compares all four channels exactly, including RGB under zero alpha. `[0,0,0,0]`, `[1,0,0,0]` and `[0,0,0,255]` are distinct. No decoding, compositing, tolerance, colour conversion or alpha discard happens inside the helper.
- [tested] `offPalettePixels` counts every region pixel outside the palette. `offPaletteSamples` contains absolute top-left image coordinates and RGBA. `sampleLimit` defaults to 16, accepts integers 0–1000, and caps each sample array without truncating counts. Duplicate palette entries do not multiply counts.
- [general] Record where bytes came from: decoded authored source, renderer readback or compositor output, plus all normalization. Those byte spaces are not interchangeable. The native example measures opaque Canvas `getImageData` bytes with no conversion; transparent vectors prove the pure function only, not native alpha parity.

```js
import {measureRgbaRegion} from './measure-rgba-regions.mjs';
const result = measureRgbaRegion({
  rgba, width: 64, height: 32,
  region: {x: 8, y: 8, width: 16, height: 8},
  palette: [[32,48,64,255], [224,208,160,255]],
  grid: {size: 2, originX: 8, originY: 8}, sampleLimit: 16
});
// result: pixels, offPalettePixels, offPaletteSamples,
// completeCells, partialCells, splitCells, splitSamples
```

## Declared integer cells

- [tested] The grid describes square cells of `size` pixels, aligned to the explicit image-coordinate origin. A complete cell is split when any RGBA differs from its top-left pixel. It counts once regardless of how many pixels differ. Samples retain the cell origin, expected RGBA and first differing pixel. Uniform off-palette blocks and split blocks containing only allowed colours are different findings.
- [tested] Every grid cell intersecting the region but not completely contained in it contributes to `partialCells`, and is excluded from split measurements. With a 4×4 region, size 2 and origin `(1,-1)`, one cell is complete and eight are partial. Cropping to `(1,1,3,3)` against origin `(0,0)` produces one complete and three partial cells. These cases are public test vectors.
- [general] Declare the grid from a known contract. This count does not infer an authored pixel scale, diagnose every mixel, or decide whether a deliberately nonuniform block is good art. Grid sizes are bounded to 1–1,000,000,000; origins to ±1,000,000,000.

## Native text and retained evidence

- [tested] The [native fixture](../../../examples/web/harness/text-fit-fixture.mjs) registers two actual `BitmapText` objects. The [probe](../../../examples/web/phaser-probes/phaser-verification-evidence-kit.mjs) checks their native `fontData.chars`, `getTextBounds()` characters and `getBounds()` rectangles against explicit allocations. Compact scale 1 and large scale 2 use the same generated 3×5 ASCII font, identity camera, integer positions and opaque colour strip. Font texture bytes and glyph codes are retained. No second layout engine or string-length fit estimate is used.
- [tested] This is a `CanvasRenderer` software-lane fixture. Its camera explicitly uses `roundPixels=false`: Phaser 4.2.1 Canvas sprite batching adds 0.5 source pixels to destination dimensions when rounding is enabled. Integer positions and disabled smoothing preserve the declared blocks at both supported scales. The report records the actual camera settings, layout revision and scale. This does not change a consumer game's renderer policy.
- [tested] The default run retains both positives and four adverse cases. One injected magenta pixel yields one off-palette pixel; changing one pixel to another palette colour yields one split cell and zero off-palette pixels. The unbroken word has native width 54 against allocation width 30. Missing `X` (code 88) fails actual font coverage although the resulting native bounds fit. Separate `--mutation off-palette|split-cell|long-word|missing-glyph` runs exit 1 from those measured failures; the default exits 0 only when positives and corresponding adverse witnesses agree.
- [tested] Each run creates a unique evidence directory and prints its path in JSON. `--output <new-directory>` selects a new directory and refuses existing directories. Before assertions, each case retains lossless PNG, decoded RGBA, its SHA-256, declared region/palette/grid, font identity, required/missing/native characters, allocation, bounds, revision and failure facts. Phaser, fixture, helper and probe source bytes/hashes are retained alongside font/colour-strip bytes. A failed run keeps its report and compositor screenshot. `finally` records native destruction and closes the browser context, browser and dynamic-port server.
- [general] Inspect retained mismatch content, not just nonzero status. These measurements cover the declared Canvas fixture only: arbitrary fonts, transforms, effects, WebGL/compositor alpha parity and whole-game text fitting remain unverified. Palette membership and fitting rectangles do not establish source authenticity or final paint ownership; use [causal pixel observation](causal-pixel-observation.md) for that separate witness.

## Reuse producer instruments

- [documented] The installed agent-sprites 0.99.0 `agent-sprites:sprite-review` skill documents the following commands and advisory outputs. This table records that checked interface; it does not claim a new producer run, numerical parity, or a Phaser implementation of producer metrics. `<plugin-root>` denotes the agent-sprites installation root.

| Producer command | Existing output | Boundary |
| --- | --- | --- |
| `node "<plugin-root>/scripts/run-managed.js" verify art/hero.atlas.json --review --pairs "#f0e0c0:#202030" --min-contrast 4.5` | Distinct colours per frame/tag, gray-level ladder, WCAG contrast of declared pairs | Review output is advisory and does not fail verification; no CVD palette distance or accessibility certification |
| `node "<plugin-root>/scripts/run-managed.js" pixel-step shot.png --crop 4,4,20,20` | On-screen pixel step of the declared screenshot crop | Producer-owned inference; the RGBA helper instead measures uniformity against a caller-declared grid |

- [general] Reuse producer review output where needed. This stage supplies no PNG decoder, contrast implementation, CVD simulation, still-folder runner, contact sheets, silhouette/motion/reduced-motion scanner, consumer migration or adoption/savings claim.
