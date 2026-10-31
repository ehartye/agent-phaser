# Panels in Phaser 4.2.1: NineSlice, tiled pieces, Graphics and Shapes

Which object draws a panel, a plate or a divider, and when each one keeps whole source pixels. Reproduce the tested facts with
`node examples/web/phaser-probes/phaser-pixel-ui-panels.mjs <project>` (WebGL on the software renderer, pixels read back from the
canvas). The strict tiled-piece recipe is section 4 of [text and panels](pixel-perfect-text-and-panels.md); Phaser's overview is
`node_modules/phaser/skills/graphics-and-shapes/SKILL.md`.

## Pick the object

| Panel need | Object | Pixel-safe |
| --- | --- | --- |
| Authored frame, flat centre | `NineSlice` without tiling | yes, any size |
| Authored frame, patterned centre | `NineSlice` with `tileX` and `tileY` | only at sizes the tiles divide |
| Authored frame, patterned centre, any size | four corners plus `TileSprite` edges and centre | yes |
| Flat plate or divider | `Rectangle` shape or `Graphics.fillRect` at whole coordinates | yes, with the pixel-art context below |
| Rounded or curved plate | authored corner art in a `NineSlice` | `Graphics` arcs are tessellated, not pixel art |
| Strict-palette modal backdrop | hard-alpha dithered `TileSprite` | aligned whole blocks; fade by changing density patterns |
| Declared translucent modal backdrop | `Rectangle` inside the scrim region | explicit underlay, alpha and blended-colour budget; opaque chrome stays strict |

- [general] Choose by the widths the layout can produce, not by the one you drew first: a panel that is always the same size can
  be a plain `Image`; one that takes any width needs tile-snapped sizes or separate pieces.

## NineSlice facts

- [documented] The constructor is `(scene, x, y, texture, frame, width, height, leftWidth, rightWidth, topHeight, bottomHeight, tileX,
  tileY)`, also `scene.add.nineslice`. The origin defaults to 0.5, so `setOrigin(0, 0)` first when laying out from a corner. A
  zero `topHeight` and `bottomHeight` makes a three-slice whose height is the frame height (`src/gameobjects/nineslice/NineSlice.js`).
- [documented] A frame that carries `scale9Borders` (an atlas exported with nine-slice data) supplies the four widths itself.
- [documented] Without `tileX` and `tileY` the centre and edges are one stretched quad each. Phaser 4.0.0 added the tiling
  (`changelog/v4/4.0/CHANGELOG-v4.0.0.md`), so the older advice "NineSlice always stretches" is out of date.
- [tested] With tiling, `floor((width - left - right) / centreSourceWidth)` tiles are laid and then stretched to fill the remainder.
  On an 8 px frame with 2 px borders, width 24 drew `RGBW` five times exactly; width 22 laid four tiles of 4.5 px and showed `RR`
  twice, a doubled source pixel.
- [general] Snap the requested size before you set it, then lay out against the snapped size:

```ts
// centre = frame width minus the two borders; returns the nearest width the tiles divide, never below left + right + centre
const snapPanelWidth = (want: number, left: number, right: number, centre: number) =>
  left + right + Math.max(1, Math.round((want - left - right) / centre)) * centre;
```

- [documented] The `width` and `height` setters clamp to the borders and rebuild the vertices, and the vertex array when the tile count
  changes; `setSize` also resizes a default hit area. Size a panel when it lays out, not every frame. `setScale` and
  `setDisplaySize` scale the corners too, so size panels with `setSize`.
- [documented] NineSlice has one `tint` with a tint mode (no `tint2` in its source), a single alpha, and no Flip or Lighting
  component (`src/gameobjects/nineslice/NineSlice.js` mixins).
- [tested] With NEAREST sampling a fractional position only moves the whole panel to the nearest pixel: x 0.4 drew at pixel 0 and
  x 0.6 at pixel 1, without uneven texels. Uneven pixels come from fractional sizes and scales, not from position.
- [documented] The WebGL renderers for NineSlice and BitmapText build quads from the transform matrix without calling
  `willRoundVertices`, so `camera.roundPixels` and `vertexRoundMode` do not apply to them; Image, Sprite, Text, Stamp, Tile and
  TileSprite do (`src/gameobjects/nineslice/NineSliceWebGLRenderer.js`, `src/gameobjects/bitmaptext/BatchChar.js`,
  `src/renderer/webgl/renderNodes/transformer/`). Keep their parents on whole coordinates.

## Graphics and shapes

- [tested] On a context created with the default `antialiasGL: true`, a `Graphics` rounded rectangle had 3 intermediate grey levels
  at its edge; with `pixelArt: true` (which sets `antialias` and `antialiasGL` false) it had none. The flag is read when the WebGL
  context is created, so it cannot be changed later (`src/core/Config.js`).
- [documented] `Graphics` and shapes have no texture and ignore `roundPixels` ("Game Objects without textures, like Graphics, ignore
  this property"). Keep their coordinates whole.
- [documented] Rounded corners: `Rectangle` shapes gained them in 4.0.0, 4.1.0 fixed regressions in the rounded rectangle path,
  and the radius is a number or `{ tl, tr, bl, br }` (negative is concave). The arcs are tessellated segments, so a small radius is
  a polygon, not a hand-placed pixel corner. Use rounded rectangles for debug overlays and non-pixel UI.
- [documented] `Graphics` replays its command buffer every frame and has no `Origin`, size or bounds components, so it gets no hit
  area; call `generateTexture` once for a static plate and put a `Zone` over a clickable one. Shapes have no `setTint`; use
  `setFillStyle`.
- [documented] `Layer` became a true `GameObject` in 4.1.0 (filters now work on it); a `Container` has no size until `setSize` and no
  texture, so give a panel container its size before `setInteractive` ([pointer and mouse](../../phaser-input/references/pointer-and-mouse.md)).

## Modal backdrop policies

- [general] Select the policy explicitly. Strict mode uses authored opaque/transparent scrim texels, object alpha 1 and physically aligned tiles; its palette includes the opaque scrim colour. Change pattern density instead of fading object alpha. A translucent backdrop is a scoped compositing exception: declare the underlay, alpha token/time samples, permitted blended colours and colour budget. Never apply that exception to opaque chrome or raw-source authentication.
- [tested] `phaser-pixel-ui-panels.mjs` retains PNG/RGBA, source/fixture hashes, renderer/camera state and exact [RGBA-region metrics](../../phaser-verification/references/visual-evidence-instruments.md). Its identity-camera WebGL fixture uses grid 2, an opaque white/red underlay and black scrim. Ten dither samples use densities `[0,2,4,6,8,10,12,14,15,16] / 16`; ten translucent samples use alpha bytes `[0,16,32,48,64,80,96,112,128,144] / 255`. Steady states use density `8 / 16` and alpha `128 / 255`. Each sample keeps complete unsplit blocks; strict samples have zero off-palette pixels, while translucent samples allow only their two declared colours. Green opaque chrome remains exact throughout.
- [tested] The default probe also retains three adverse controls. `--scrim-mutation dither-colour`, `dither-alpha` or `translucent-budget` requires a standalone failure after all samples are captured. Blue dither texels and alpha 0.5 fail strict palette membership; alpha `192 / 255` exceeds the declared maximum and blended palette. Lossless frames and measured failures are written before assertions; owned game/capture resources are released on positive and adverse runs.
- [general] Counts describe these indexed samples, not a continuous tween or every backdrop. Existing `phaser-rendering-textures-and-shaders.mjs` keep/dither checks establish renderer alpha behaviour separately; neither probe establishes a UI preference, readability, accessibility or consumer acceptance.

## Verify

- [tested] Read pixels, not objects: create the game with `render: { preserveDrawingBuffer: true }`, draw `game.canvas` into a 2D
  canvas and read a row (the probe encodes each colour as a letter and compares strings). The harness equivalent is in
  [verifying assertions](../../phaser-verification/references/verifying-assertions-and-harness.md).
- [general] Test panel sizes as a pure function over every width the layout can produce, and fail when the snapped width differs from
  the allocated width by more than your tolerance.

## Links

[text and bitmap fonts](text-and-bitmap-fonts.md), [clipped scrolling](pixel-ui-clipped-scrolling.md), [footprint](pixel-perfect-footprint.md).
