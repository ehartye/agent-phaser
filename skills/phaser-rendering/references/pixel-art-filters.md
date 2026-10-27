# Pixel-art filters and fractional scale (Phaser 4.2.1)

What Blocky, Pixelate, Quantize and GradientMap do to pixels, which one keeps a palette, in what order they combine with Blur, and how crisp `smoothPixelArt` is at a fractional zoom. Filter basics, padding and the list order rule are in [filters](filters.md). Probes: `phaser-rendering-pixel-filters.mjs` and `phaser-rendering-smooth-pixel-art.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md); they read pixels on the default WebGL 1 context, on a software rasteriser and on a discrete GPU, with the same results unless a bullet says otherwise.

## The four filters

| Filter | Call | Effect on the source's colours |
| --- | --- | --- |
| Blocky | `addBlocky({ size, offset })` | none added: each block takes one source colour |
| Pixelate | `addPixelate(amount)` | blends: new colours appear |
| Quantize | `addQuantize({ steps, gamma, offset, mode, dither })` | fewer colours, snapped to steps |
| GradientMap | `addGradientMap({ ramp, dither, colorFactor, color })` | recoloured by brightness along a ramp |

- [documented] Read from `src/gameobjects/components/FilterList.js` and `src/filters/*.js`: Blocky `size` is a number or `{ x, y }` (default 4, minimum 1) and `offset` moves the grid from the top-left; Quantize `steps` is `[r, g, b, a]` (default 8 each; drop alpha to 1 for opaque art), `mode` 0 is RGBA and 1 is HSVA (then `steps`, `gamma` and `offset` apply to hue, saturation, value and alpha); GradientMap takes a `ColorRamp` or its config such as `{ colorStart, colorEnd }`, reads brightness through `colorFactor` (default `[0.3, 0.6, 0.1, 0]`), and does not dither by default. All four work on `camera.filters.external` or `.internal`, or on one object after `enableFilters()` ([filters](filters.md)).
- [tested] Blocky with `size: 8` on a 64 x 64 gradient of 4,096 colours left every 8 x 8 block one colour and added no colour the source lacked (`blocky.notInSource` 0 in `phaser-rendering-pixel-filters.mjs`). Use it when the palette must survive; Phaser's own text adds that it works best with antialiasing off, so it can read unfiltered texels.
- [tested] Pixelate blended: 43 of its 49 output colours were not in the source, and the block size is `amount + 2` (`Pixelate(4)` is uniform over 6 x 6 blocks, `Pixelate(8)` over 10 x 10; `Pixelate(2)` over 4 x 4). Phaser's filters document says the same; its Pixel Art Guide's cheat sheet shows `addBlocky(6)` where it means `addPixelate(6)`, so copy the call from the table above.
- [tested] Quantize with `steps: [4, 4, 4, 1]` reduced the 4,096-colour gradient to 24 colours (the ceiling is 4 x 4 x 4 = 64). `dither: true` gave 24 colours as well, so dither changes which pixels take which level and not how many levels there are; judge it by eye, not by colour count.
- [tested] GradientMap with a black-to-red ramp turned gray 0, 128 and 255 into red 0, 128 and 255 with no green or blue: brightness is the position on the ramp. Two- or three-stop ramps give palette swaps; animate the ramp for palette cycling.

## Order and placement

- [tested] Order is draw order. Blocky then Blur ended with no uniform blocks and about three thousand colours the source did not have (2,913 on the software rasteriser, 3,171 on the GPU): a soft edge; Blur then Blocky ended with every block uniform. Put the look you want to see last, and put a palette-keeping filter after anything that blends.
- [tested] A filter on one object stays on that object: a cropped image with an internal Blocky was blocky inside its crop and drew nothing outside it. A camera filter changes the whole frame, including a camera fade ([filters](filters.md)).
- [general] Choose by intent: Blocky for a pixel look that must keep the art's palette, Quantize for a retro palette limit, GradientMap for palette swaps and cycling, Pixelate only when blending is acceptable (a transition, censoring). A game that already draws at its art resolution and scales with integer zoom needs none of them for crispness.

## Fractional zoom: `pixelArt` against `smoothPixelArt`

Measured with a 3 x 2 texel pattern of six known colours at art scale 2, the camera at zoom 3.5 and 4.5, with and without a rotation of 0.05 rad, at device pixel ratios 1 and 1.5 (canvas sized to device pixels, so one game pixel is one device pixel). Exact fraction is the share of the expected texel area that is exactly the source colour.

| Config | Zoom | Exact fraction | Blended edge |
| --- | --- | --- | --- |
| `pixelArt: true` | 3.5 and 4.5 | 0.998 to 1.003 | 0 pixels |
| `smoothPixelArt: true` | 3.5 (7 px texel) | 0.735 to 0.765 | 1 pixel wide |
| `smoothPixelArt: true` | 4.5 (9 px texel) | 0.79 to 0.84 | 1 pixel wide |

- [tested] `pixelArt: true` copies exact colours at a fractional zoom and never blends, so texels land in uneven widths (a 3.5 zoom cannot cover every texel with the same whole number of pixels). `smoothPixelArt: true` keeps one-pixel-wide blended edges between texels and the exact colour inside them. Rotation changed the numbers by a few percent and not the edge width. The numbers did not change between device pixel ratios 1 and 1.5, or between the software rasteriser and the discrete GPU, except that the 4.5 zoom interior was 0.79 on the first and 0.84 on the second.
- [tested] "Sharp interiors" holds, but a one-pixel edge costs a quarter of a 7-pixel texel and a tenth of a 9-pixel one. The bigger the texel footprint, the crisper `smoothPixelArt` looks; at an integer footprint `pixelArt` is exact and needs no smoothing ([pixel-perfect footprint](../../phaser-pixel-ui/references/pixel-perfect-footprint.md)). Choose `smoothPixelArt` for a camera that zooms by fractions or rotates, and accept a thin soft edge.
- [documented] `smoothPixelArt` turns `pixelArt` off and needs WebGL; on a supplied WebGL 2 context its shader fails ([WebGL backends](webgl-backends.md)).
