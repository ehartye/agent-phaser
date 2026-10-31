# Reading and asserting pixels in a Phaser 4 game

Read this before you assert a colour, compare a screenshot or grab the canvas. Phaser's snapshot calls look simple and have four traps in 4.2.1. Backed by [`phaser-verification-pixels.mjs`](../../../examples/web/phaser-probes/phaser-verification-pixels.mjs); the debug API that wraps them is in [assertions and harness](verifying-assertions-and-harness.md).

## Four ways to see the screen

| Method | Sees | Valid when | Use it for |
| --- | --- | --- | --- |
| `renderer.snapshotPixel(x, y, cb)` | the framebuffer, end of the next rendered frame | a frame will render; one request per frame | a known colour at a known place |
| `renderer.snapshotArea(x, y, w, h, cb)` | the same, as a PNG `Image` | same; the callback arrives after an image load | share of a palette in a region; evidence images |
| `renderTexture.snapshotPixel` / `snapshotArea` | one dynamic texture, at once | after `render()` has run its commands | checking a generated texture without a frame |
| `page.screenshot()` / `locator.screenshot()` | the compositor output: canvas, DOM overlays, CSS scale, device pixel ratio | any time, even between frames | what the player sees; golden images |
| `canvas.toDataURL()`, `drawImage(canvas)` | the WebGL drawing buffer | only inside the render task | nothing: avoid |

- [tested] `drawImage(game.canvas)` read the right colour in the same task as a render and `(0, 0, 0)` after the frame was presented (`preserveDrawingBuffer` is false). A test that grabs the canvas with `page.evaluate` after a wait reads black.
- [documented] Phaser reads the framebuffer from `postRender`, inside the frame, so it needs no `preserveDrawingBuffer`; the request is dropped without a callback if the context is lost (`src/renderer/webgl/WebGLRenderer.js`).

## snapshotPixel and snapshotArea semantics

- [documented] Coordinates are `Math.abs(Math.round(x))` of drawing-buffer pixels with a top-left origin (the Y flip is done for you) (`src/renderer/snapshot/WebGLSnapshot.js`). The callback gets a `Phaser.Display.Color`: read `red`, `green`, `blue`, `alpha` (0 to 255).
- [tested] Opaque fills read exactly (`[255, 0, 0, 255]`); white at alpha 0.5 over black read `127`, not 128; a point outside the buffer read `[0, 0, 0, 0]` with no error.
- [tested] The coordinates are game pixels, not world, CSS or device pixels. With `scale.zoom: 2` and `devicePixelRatio: 2` the canvas was 200 by 200 and `(150, 10)` still read the colour drawn there. Convert a world point with `(wx - cam.worldView.x) * cam.zoom`.
- [tested] Trap 1: one request per frame. Two `snapshotPixel` calls before the same frame fulfilled only the second; the first callback never ran, and a promise wrapped around it hangs. Read points one at a time, a frame apart, or take one `snapshotArea` and read every point from it.
- [tested] Trap 2: a negative coordinate is mirrored: `snapshotPixel(-150, 10)` read the pixel at `(150, 10)`. Clamp before you call.
- [tested] Trap 3: on a `transparent: true` canvas `snapshotPixel` returns premultiplied colour (`[127, 127, 127, 127]` for white at 50 percent) while `snapshotArea` un-premultiplies (`[255, 255, 255, 127]`) because it follows `game.config.premultipliedAlpha`. Convert pixel reads with `c * 255 / alpha` before comparing with an authored colour.
- [tested] Trap 4: a `RenderTexture` shows nothing until `render()` has executed its queued commands: `fill()` then `snapshotPixel` read `[0, 0, 0, 0]`, after `render()` it read the fill. That read answered synchronously, with no frame.
- [general] Default Playwright launches (the headless shell, software WebGL) logged `GPU stall due to ReadPixels` console warnings in these runs, with and without snapshot calls. A zero-warning console rule needs to allow that pattern, as the sibling probes do; it did not appear under the new headless mode with a hardware renderer.
- [general] In a hand-driven loop, fulfil a read by stepping one frame: `snapshotPixel(...); game.step(performance.now(), 0)`; in a running loop wait for the next `Phaser.Core.Events.POST_RENDER`.

```js
// Read several points, one frame each, from a running loop. Returns [r, g, b, a] per point.
const readPixels = async (game, points) => {
  const out = [];
  for (const [x, y] of points) {
    out.push(await new Promise((done) => {
      game.renderer.snapshotPixel(x, y, (c) => done([c.red, c.green, c.blue, c.alpha]));
    }));
  }
  return out;
};
```

## Tolerance and colour

- [tested] On one machine, software WebGL and the platform GPU read identical values for four flat or simple cases: a flat fill, white at 37 percent over black (94), a four-corner gradient and an additive blend. Run `COMPARE_RENDERERS=1 node phaser-verification-pixels.mjs <project>` to repeat it. Filters, lights, blur and text were not compared.
- [general] Tolerances such as `+/- 1` for blends or `+/- 6` for lighting are diagnostic choices requiring a declared purpose; they cannot establish source authenticity or final-screen contribution. Neutralising day/night multiplies or tints isolates an effect but proves only that modified scene. Keep strict unfiltered source-colour checks exact. Sample interiors when diagnosing colours: a one-pixel debug outline on a pixel boundary read `[144, 16, 144]`, not pure magenta.
- [general] Phaser draws in sRGB with no gamma step, so an authored hex colour is the expected value for an unlit, untinted fill.
- [general] Assert shares instead of exact positions when art moves: take one `snapshotArea`, draw the `Image` to a 2D canvas, and count pixels within tolerance of each palette colour.

```js
// In the page: fraction of a region within `tol` of an RGB colour.
const share = async (game, rect, rgb, tol = 6) => {
  const img = await new Promise((done) => game.renderer.snapshotArea(rect.x, rect.y, rect.w, rect.h, done));
  const c = Object.assign(document.createElement('canvas'), {width: rect.w, height: rect.h});
  const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, rect.w, rect.h).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if ([0, 1, 2].every((k) => Math.abs(d[i + k] - rgb[k]) <= tol)) n++;
  return n / (rect.w * rect.h);
};
```

## Authentic source and final contribution

- [general] For exact declared RGBA membership, split integer cells and actual native BitmapText glyph/bounds evidence, use [visual evidence instruments](visual-evidence-instruments.md). Record byte space, alpha normalization and grid origin; these bounded measurements do not replace strict unfiltered assertions or prove paint attribution.
- [general] Strict raw-source equality applies to the unfiltered case; a stable intentional ColorMatrix can change final RGB without making the loaded art unauthentic. [Causal pixel observation](causal-pixel-observation.md) combines independent decoded-source authentication, native dispatch, an exact mapped opacity mask and shown/hidden/restored final frames under unchanged effects. Geometry, source equality or a matching screenshot alone cannot establish who painted those pixels.

## Golden images, and when not to use them

- [documented] Playwright's `toHaveScreenshot` keeps a baseline per browser and platform, advises generating baselines in the environment that checks them ([test snapshots](https://playwright.dev/docs/test-snapshots)), and takes `threshold` (default 0.2, a YIQ colour distance per pixel), `maxDiffPixels`, `maxDiffPixelRatio`, `scale` (`css` by default) and `animations` ([page assertions](https://playwright.dev/docs/api/class-pageassertions)). `animations: 'disabled'` stops CSS and Web Animations only, so it does not freeze a canvas game; freeze Phaser with the clock.
- [general] Use a golden to answer "did the look change" for a composed scene at a fixed size with the interface hidden, a fixed seed and a controlled clock ([deterministic driving](deterministic-test-driving.md)). Tag it `@gpu`, keep one baseline set from one machine class, and give it a one-line update command.
- [general] Use a known-colour read to answer "is the right thing at the right place" (the lake is blue under the player). Do not golden particles, camera shake, system-font text or anything that reads the wall clock; their pixels differ between runs by design.
- [general] Save the failing frame, the expected colour and the point as evidence on failure. A screenshot alone cannot say which pixel mattered.
