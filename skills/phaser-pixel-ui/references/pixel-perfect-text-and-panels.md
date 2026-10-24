# Pixel UI: device pixels, bitmap text and panels (Phaser 4.2.1)

Device pixels, `BitmapText`, tiled panels and text fit. Index: [pixel-perfect-and-ui.md](pixel-perfect-and-ui.md).

## 2. Device pixels, not CSS pixels

- [general] `Scale.RESIZE` sizes the canvas in CSS pixels. On a display with `devicePixelRatio` 1.25 or 1.5 the browser stretches that canvas by a
  fraction and every art pixel becomes a different width. Size the canvas to the page times the ratio and set Phaser's CSS zoom to the
  inverse, so each layer picks its integer source-pixel footprint from device pixels:

```ts
scale.scaleMode = Phaser.Scale.NONE;
const dpr = Math.max(1, devicePixelRatio), w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
if (scale.zoom !== 1 / dpr) scale.setZoom(1 / dpr);
if (scale.width !== w || scale.height !== h) scale.resize(w, h);
// re-apply on window resize and on matchMedia(`(resolution: ${devicePixelRatio}dppx)`) change (browser zoom, moving monitors)
```

This is the one `1 / dpr` in the codebase; allow-list it in the "no fractional scale" test. A browser spec at DPR 1.25, 1.5 and 3 proves
it.

## 3. All text is `BitmapText` from the tool's own font export

- [general] Never `add.text`/`make.text`, CSS fonts, or browser tooltips for visible game UI. Ban them with a test that scans the presentation code
  and checks for unintended browser-rendered game chrome. Semantic controls and native input bridges follow section 7; do not ban them by counting DOM nodes.
- [general] Use the tool's exported metrics (agent-sprites `ui-phaser.json`: advances, frame rectangles, texture coordinates per tone) and
  register each tone as a `BitmapFont` with `cache.bitmapFont.add(key, { data, texture, frame: '__BASE', fromAtlas: false })`. **A tone
  is a different set of glyph frames, never a tint.**
- [general] Prefer released agent-sprites 0.88.0's pinned `ui-runtime.mjs`, which exports `normalizeBitmapFont`, `bitmapLineWidth`, `wrapBitmapText`,
  `measureBitmapText` and `placeBitmapText`. Normalize once per loaded font; the immutable snapshot preserves advances, authored
  tones, atlas rectangles and trim offsets. Use the same calculations for Node layout and native binding instead of maintaining
  another metrics implementation. Keep existing native adapters until their required export and downstream parity are verified.
- [general] A single-density native path can draw one `BitmapText` per wrapped line at font scale 1 and integer offsets. A contextual adapter
  consumes the plan in its declared space, including fractional local destinations. Retain game-authored newline/tab/empty,
  trailing-advance, line-height/spacing and terminal-space policies explicitly; defaults do not prove legacy parity. Keep fitting,
  ellipsis and glyph-coverage decisions in the game. Missing legacy cell/baseline or ink stays unknown; texture dimensions do not
  establish it. Trim offsets apply once and cannot substitute for reported source-cell ink bounds.
- [general] Floating world labels are the same face at the *world* layer's zoom: rise in whole-pixel steps, blink out instead of fading.

## 4. Panels are tiled, not stretched

Phaser's `NineSlice` stretches its centre and edges, and with `tileX`/`tileY` (4.0.0) still stretches its tiles to fill the remainder unless the
size is a whole number of tiles ([panels](panels-nine-slice-and-graphics.md)). A stretch by a fraction (a 16 px centre drawn 20 px wide) puts texel
boundaries between device pixels, which breaks the one-scale rule wherever the centre has detail (a slot inset, a highlight line). For a size that is
not a tile multiple build the panel from nine whole-pixel pieces instead: four corners at their own size, and the edges and centre as `TileSprite`s that repeat the art in
whole source pixels. Take insets, padding, minimum sizes and painted bounds from the tool's export; there should be no size in the UI
code that came from looking at the art. (A flat single-colour shadow plate has no detail, so `NineSlice` is fine there.)

Prefer the same pinned sprites runtime's `planNineSlice` and `iterateNineSliceTiles` for portable skin geometry, then bind the
source crops and local/physical destinations to native rendering. Preserve authored padding/minimum-size policy in the adapter;
the pure planner does not infer a minimum. Existing Canvas wrappers keep their positive-integer guards and defaults.
Attribute a copied runtime's software source/version separately from the font/skin art manifest. Updating pure helper code does
not require regenerating font images or relabeling historical PNGs with a new producer version.

- [general] Dim behind a modal with the skin's **dithered scrim** (a hard-alpha checkerboard) in a `TileSprite`, not a translucent rectangle.
- [general] In the common whole-zoom/single-density path with physically aligned origins, slide with a tween that rounds local positions
  every frame (`setPosition(Math.round(fx + (tx - fx) * t), ...)`). For contextual motion, project the intended position to physical
  space, apply the declared physical paint quantization, then project back for native placement. Do not round local coordinates:
  at `S = 1.5`, local x = 1 becomes physical x = 1.5 even when `P = 2`. Preserve continuous semantic geometry independently; when
  motion changes a context mapping, advance its revision and cancel held input before publishing it as described in section 1.
  Leave by sliding. Nothing fades: a half-transparent pixel is a colour the art does not contain.
- [general] Interface code never uses tint, rotation, alpha blends, `Graphics` or shapes as chrome. Enforce each with a source-scanning test.

## 5. Text must fit, in three layers

A string that runs off its box is a bug the type system cannot see. What worked:

1. [general] **Static**: a table of every container (id, face, width as a function of the logical screen width, maximum lines) and every string
   that can go in it, measured with the real glyph advances at every supported width. A mutation block proves the check can fail.
   A source scan for unbounded `.print(` of dynamic text with a list of allowed exceptions that may only shrink.
2. [general] **Runtime guard**: every text object registers itself; a debug call measures what is on screen from the real transforms and lists
   lines that leave the screen, leave a declared clip box, or overlap another line. The browser fixture fails any test with a finding.
3. [general] **GPU walk-through**: open every screen with worst-case content at several viewport sizes and scales; compare pixels outside the
   window rectangle with the window hidden and shown.

Details that mattered: wrap to `maxLines` and end in an ellipsis; take width and height from the container, never from the text; let a clip
container declare its bounds; hide what a stepper covers so the guard never sees two texts on one pixel; keep a minimum logical height for the
scale override. Add a **glyph-repertoire test**: collect every string the game can show and require the bitmap font to draw all of it (Phaser skips a
character that is not in the font: no glyph, no advance and no `?`, see [text and bitmap fonts](text-and-bitmap-fonts.md)). Key read-model deny tables by the sim's union so a new deny reason fails to compile
without words. A screen that rebuilds itself on a key must re-centre its window. Toasts: cap at two, merge identical messages, and give changes
already visible elsewhere a quiet flag.

A `Container` with a size measures its hit area from its centre (`displayOriginX = w / 2`): `setInteractive(new Rectangle(0, 0, w, h))` covers
`-w/2..w/2`, half a size away from children laid out from (0, 0), so a click on a slot's centre selects the neighbour. Offset the rectangle (or put the
zone on a child) and test by clicking centres. Layout and focus: [layout, focus and navigation](ui-layout-focus-and-navigation.md).

Cover text fitting twice: a pure unit test of the measuring and layout function, and a browser spec that checks the rendered text stays inside its box.
